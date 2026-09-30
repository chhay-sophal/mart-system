# @mart-system/web

Customer-facing storefront: shoppers pick a branch, browse its live catalog, and build a cart for pickup at the counter. Talks only to the backend's unauthenticated `/api/public/*` routes — no login, no staff data. See [docs/storefront-plan.md](../../docs/storefront-plan.md) for the plan and what's still to come (checkout, branch hours, the IMS online-orders page).

## Running locally

Start the backend (see `apps/backend/README.md`), then:

```sh
cp .env.example .env   # optional — the defaults below match local dev
pnpm dev               # http://localhost:5174 (IMS keeps Vite's default 5173)
```

| Variable | Default | |
|---|---|---|
| `VITE_API_BASE_URL` | `http://localhost:4000` | Backend URL, baked in at build time |
| `VITE_MART_NAME` | `Your Mart` | Shown in the header, footer and browser tab |

## How it's put together

- **Branch** — the chosen branch is remembered in `localStorage` and falls back to the first open store. Every price and stock level on screen is that branch's.
- **Cart** — stores only product ids and quantities (plus each item's name, as a label). Prices always come from the live catalog, so a price change or a branch switch is reflected rather than a stale snapshot. Items the branch doesn't carry or has run out of are listed separately and left out of the total.
- **Filters** — the catalog's aisle, search, stock and sort filters live in the URL, so a filtered view can be linked and survives a reload.
- **Aisles** come from `Product.category`, which is free text set in IMS; products without one are grouped under "Other".
- **Not yet**: checkout (build step 4), product photos, Khmer product names, opening hours and a map (build step 3).
