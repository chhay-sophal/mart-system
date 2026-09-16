# CI-only artifact for now — no real hosting target chosen yet. Build from
# the REPO ROOT, not this directory, since a pnpm workspace needs the whole
# tree to resolve @mart-system/api-client:
#   docker build -f apps/ims/Dockerfile -t mart-system-ims .
#
# VITE_API_BASE_URL is baked in at build time (Vite inlines import.meta.env
# at build, not runtime) — pass the real backend URL once one exists:
#   docker build -f apps/ims/Dockerfile --build-arg VITE_API_BASE_URL=https://api.example.com -t mart-system-ims .

FROM node:22-slim AS build
WORKDIR /repo
RUN corepack enable && corepack prepare pnpm@11.22.0 --activate

COPY . .
RUN pnpm install --frozen-lockfile

ARG VITE_API_BASE_URL=http://localhost:4000
ENV VITE_API_BASE_URL=$VITE_API_BASE_URL
RUN pnpm --filter @mart-system/ims build

FROM nginx:1.27-alpine AS runtime
COPY --from=build /repo/apps/ims/dist /usr/share/nginx/html
EXPOSE 80
