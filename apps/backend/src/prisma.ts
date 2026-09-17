import path from "node:path";
import { fileURLToPath } from "node:url";
import { PrismaLibSQL } from "@prisma/adapter-libsql";
import { PrismaClient } from "@prisma/client";
import { env } from "./env";

// Reuse the client across tsx watch reloads in dev instead of opening a new
// connection pool on every file save.
const globalForPrisma = globalThis as unknown as { prisma?: PrismaClient };

const PRISMA_DIR = path.join(path.dirname(fileURLToPath(import.meta.url)), "..", "prisma");

// DATABASE_URL is a libsql-style URL: file:./dev.db locally, file:./test.db
// for tests, libsql://<db>.turso.io in production. A relative file: path here
// is resolved against prisma/ explicitly — the Prisma CLI (migrate/seed)
// always resolves a relative file: URL against schema.prisma's own directory
// regardless of cwd, but @libsql/client resolves it against the process's
// cwd instead; without this, `pnpm dev` (cwd = apps/backend) and
// `prisma migrate dev` would silently read/write two different database
// files for the exact same DATABASE_URL value.
function resolveDatabaseUrl(url: string): string {
  if (!url.startsWith("file:")) return url; // a real libsql://... URL — nothing to rewrite
  const relativePath = url.slice("file:".length);
  return path.isAbsolute(relativePath) ? url : `file:${path.join(PRISMA_DIR, relativePath)}`;
}

const adapter = new PrismaLibSQL({ url: resolveDatabaseUrl(env.DATABASE_URL), authToken: env.TURSO_AUTH_TOKEN });

export const prisma = globalForPrisma.prisma ?? new PrismaClient({ adapter });

if (process.env.NODE_ENV !== "production") {
  globalForPrisma.prisma = prisma;
}
