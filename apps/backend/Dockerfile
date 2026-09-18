# CI-only artifact for now — no real hosting target chosen yet, so this is
# intentionally not optimized (no pruning of unrelated workspace packages
# from the image). Build from the REPO ROOT, not this directory, since a
# pnpm workspace needs the whole tree to resolve @mart-system/shared-types:
#   docker build -f apps/backend/Dockerfile -t mart-system-backend .

FROM node:22-slim AS build
WORKDIR /repo
RUN corepack enable && corepack prepare pnpm@11.22.0 --activate
# node:*-slim ships without OpenSSL. Prisma auto-detects the OpenSSL version
# to pick the right query-engine binary AT `prisma generate` TIME — installing
# this only in the runtime stage caused a real mismatch (generate guessed
# debian-openssl-1.1.x with no OpenSSL present, but the runtime stage's newer
# OpenSSL was 3.0.x, and Prisma refused to start). Both stages need it, matching.
RUN apt-get update -y && apt-get install -y openssl && rm -rf /var/lib/apt/lists/*

COPY . .
RUN pnpm install --frozen-lockfile
RUN pnpm --filter @mart-system/backend exec prisma generate
RUN pnpm --filter @mart-system/backend build

FROM node:22-slim AS runtime
WORKDIR /repo
RUN corepack enable && corepack prepare pnpm@11.22.0 --activate
RUN apt-get update -y && apt-get install -y openssl && rm -rf /var/lib/apt/lists/*
ENV NODE_ENV=production

COPY --from=build /repo .

WORKDIR /repo/apps/backend
EXPOSE 4000
# `prisma migrate deploy` doesn't work against a real Turso DATABASE_URL --
# libSQL's remote HTTP protocol isn't a `file:` connection, and the CLI
# refuses to even validate the URL. scripts/apply-turso-migrations.mjs
# applies pending prisma/migrations/*/migration.sql directly via
# @libsql/client instead, tracked in its own _manual_migrations table.
CMD ["sh", "-c", "node scripts/apply-turso-migrations.mjs && node dist/index.js"]
