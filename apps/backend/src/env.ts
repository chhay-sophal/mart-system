import "dotenv/config";
import { z } from "zod";

const envSchema = z.object({
  NODE_ENV: z.enum(["development", "test", "production"]).default("development"),
  PORT: z.coerce.number().int().positive().default(4000),
  // libsql-style URL: file:./prisma/dev.db locally/test, libsql://<db>.turso.io in production.
  DATABASE_URL: z.string().min(1, "DATABASE_URL is required"),
  // Required once DATABASE_URL points at a real Turso database; unused for a local file: URL.
  TURSO_AUTH_TOKEN: z.string().optional(),
  JWT_SECRET: z.string().min(16, "JWT_SECRET must be at least 16 characters"),
  ACCESS_TOKEN_TTL: z.string().default("15m"),
  REFRESH_TOKEN_TTL: z.string().default("30d"),
  CASHIER_SESSION_TTL: z.string().default("14h"),
  PASSWORD_BCRYPT_COST: z.coerce.number().int().min(4).max(15).default(12),
  PIN_BCRYPT_COST: z.coerce.number().int().min(4).max(15).default(10),
  // Comma-separated allow-list (e.g. "https://ims.example.com"). Only IMS
  // calls this API from a browser (POS's sidecar is a server-to-server
  // fetch, never subject to CORS at all) — required in production so the
  // API doesn't ship wide open to any origin; optional in dev/test so local
  // work isn't blocked by not having set it yet.
  CORS_ALLOWED_ORIGINS: z.string().optional(),
});

const parsed = envSchema.safeParse(process.env);

if (!parsed.success) {
  console.error("Invalid environment configuration:", parsed.error.flatten().fieldErrors);
  throw new Error("Invalid environment configuration");
}

if (parsed.data.NODE_ENV === "production" && !parsed.data.CORS_ALLOWED_ORIGINS) {
  console.error(
    "CORS_ALLOWED_ORIGINS must be set in production — comma-separated list of origins allowed to call this API (e.g. IMS's deployed URL)."
  );
  throw new Error("Invalid environment configuration");
}

if (!parsed.data.DATABASE_URL.startsWith("file:") && !parsed.data.TURSO_AUTH_TOKEN) {
  console.error("TURSO_AUTH_TOKEN must be set when DATABASE_URL points at a real Turso database (not a local file: URL).");
  throw new Error("Invalid environment configuration");
}

export const env = {
  ...parsed.data,
  corsAllowedOrigins: parsed.data.CORS_ALLOWED_ORIGINS
    ? parsed.data.CORS_ALLOWED_ORIGINS.split(",").map((o) => o.trim()).filter(Boolean)
    : [],
};
