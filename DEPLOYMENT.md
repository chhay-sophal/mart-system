# Deployment runbook (free tier)

`apps/backend` → [Render](https://render.com) (Docker, free Web Service). `apps/ims` → [Cloudflare Pages](https://pages.cloudflare.com) (static SPA, free). `apps/pos` (the Tauri desktop app) isn't covered here — that's a separate GitHub Actions release pipeline, not a web deployment.

There's a real chicken-and-egg dependency between the two: the backend's `CORS_ALLOWED_ORIGINS` needs IMS's real URL, and IMS's `VITE_API_BASE_URL` needs the backend's real URL. Do the steps in this exact order to avoid going back and forth.

## 1. Backend → Render (do this first)

1. In Render, connect this GitHub repo and apply the `render.yaml` Blueprint at the repo root (New → Blueprint). This creates one free Web Service (`mart-system-backend`), Docker-based, using `apps/backend/Dockerfile` built from the repo root.
2. Render will prompt for every env var marked `sync: false` in `render.yaml`. Fill these in using the real values already in your local `apps/backend/.env`:
   - `DATABASE_URL` — your real `libsql://...turso.io` URL.
   - `TURSO_AUTH_TOKEN` — your real Turso auth token.
   - `JWT_SECRET` — a long random value (reuse your local one, or generate a new one — just don't reuse it anywhere else).
   - `ACCESS_TOKEN_TTL` / `REFRESH_TOKEN_TTL` / `CASHIER_SESSION_TTL` / `PASSWORD_BCRYPT_COST` / `PIN_BCRYPT_COST` — copy straight from your local `.env` (these aren't secrets, just not hardcoded in the Blueprint).
   - `CORS_ALLOWED_ORIGINS` — **leave a placeholder for now** (e.g. `https://placeholder.pages.dev`) — the real IMS URL doesn't exist until step 2. You'll come back and fix this in step 3.
3. Deploy. Once live, note the assigned URL (`https://mart-system-backend-XXXX.onrender.com` or whatever Render assigns) and confirm it's actually healthy:
   ```sh
   curl https://<your-render-url>/health
   ```
   Expect `{"ok":true}`. If it 502s on the very first request, wait ~30-60s — Render's free tier sleeps after 15 minutes idle and cold-starts on the next hit. That's expected, not a bug.
4. Apply migrations and create the first store/admin against this real database if you haven't already (from your own machine, pointed at the real `DATABASE_URL`/`TURSO_AUTH_TOKEN` in your local `.env`). Use `create-admin`, not `db:seed` — the latter is dev-only and hardcodes a known admin password:
   ```sh
   cd apps/backend
   pnpm db:migrate:turso
   pnpm create-admin
   ```
   It prompts interactively for the store name/code and admin email/name, then prints a randomly generated admin password/PIN once — save it now, it isn't recoverable afterward.

## 2. IMS → Cloudflare Pages (do this second)

1. In Cloudflare Pages, connect the same GitHub repo, and configure:
   - **Root directory**: `apps/ims`
   - **Build command**: `pnpm --filter @mart-system/ims build`
   - **Build output directory**: `dist`
   - Framework preset: none needed (Vite's defaults are already what's configured above).
2. Add an environment variable (Settings → Environment variables, for the Production environment): `VITE_API_BASE_URL` = the real Render URL from step 1 (e.g. `https://mart-system-backend-XXXX.onrender.com`).
3. Deploy. Note the assigned `*.pages.dev` URL.

No SPA-routing config is needed — Cloudflare Pages auto-serves `index.html` for any unmatched deep-link route (`/staff`, `/products`, etc.) as long as the build output has no `404.html`, which Vite's default output never does.

## 3. Close the loop

Go back to Render's dashboard and update the backend's `CORS_ALLOWED_ORIGINS` env var to the real Cloudflare Pages URL from step 2. This triggers a redeploy automatically.

## 4. Verify end-to-end

1. Open the deployed IMS URL in a browser, log in with the admin credentials `create-admin` printed in step 1.4.
2. Navigate to a non-root page (e.g. Staff or Products) and hard-refresh — confirms the SPA fallback is actually working, not just that the root page loads.
3. If login or any data fetch fails with a CORS error in the browser console, double check step 3 actually completed and the backend redeployed with the corrected `CORS_ALLOWED_ORIGINS`.

## Reference: manual setup (if not using the Blueprint)

If configuring the Render service by hand instead of applying `render.yaml`:
- **Build**: Docker, Dockerfile path `apps/backend/Dockerfile`, Docker build context = repo root (not `apps/backend/`) — the Dockerfile `COPY`s the whole monorepo to resolve `packages/*` workspace dependencies.
- **Health check path**: `/health`
- Same env vars as listed in step 1 above.
