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
# `prisma migrate deploy` only works against a local file: connection --
# libSQL's remote HTTP protocol doesn't support it. Against a real Turso
# DATABASE_URL this step needs to become `turso db shell <db> < migration.sql`
# instead, wired up when the actual deploy target (Render) is set up -- not
# yet done, so this CMD is a known placeholder, not a working prod migration path.
CMD ["sh", "-c", "npx prisma migrate deploy && node dist/index.js"]
