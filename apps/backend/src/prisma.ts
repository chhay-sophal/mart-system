import { PrismaClient } from "@prisma/client";

// Reuse the client across tsx watch reloads in dev instead of opening a new
// connection pool on every file save.
const globalForPrisma = globalThis as unknown as { prisma?: PrismaClient };

export const prisma = globalForPrisma.prisma ?? new PrismaClient();

if (process.env.NODE_ENV !== "production") {
  globalForPrisma.prisma = prisma;
}
