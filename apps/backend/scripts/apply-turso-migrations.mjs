// Applies pending prisma/migrations/*/migration.sql files directly to a real
// Turso database via @libsql/client, bypassing the Prisma CLI entirely --
// `prisma migrate dev`/`deploy` can't even validate a libsql:// URL (it
// requires a literal `file:` connection), so there's no CLI path for this.
//
// Tracks what's already been applied in its own _manual_migrations table
// (mirroring Prisma's own _prisma_migrations bookkeeping loosely), so
// running this again after adding a new migration only applies the new one.
//
// Usage: node scripts/apply-turso-migrations.mjs [--project <name>]
// Requires DATABASE_URL (a real libsql://... URL, not file:) and
// TURSO_AUTH_TOKEN in the environment (loaded from apps/backend/.env, or from
// .env.<name>.production with --project <name>).

import { createClient } from "@libsql/client";
import { config } from "dotenv";
import { existsSync, readFileSync, readdirSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { parseArgs } from "node:util";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const { values: args } = parseArgs({ options: { project: { type: "string" } } });
if (args.project) {
  const envFile = path.join(__dirname, "..", `.env.${args.project}.production`);
  if (!existsSync(envFile)) {
    console.error(`No env file for project "${args.project}": ${envFile}`);
    process.exit(1);
  }
  config({ path: envFile, override: true, quiet: true });
  console.log(`Using ${path.basename(envFile)}`);
} else {
  config({ path: path.join(__dirname, "..", ".env") });
}

const databaseUrl = process.env.DATABASE_URL;
const authToken = process.env.TURSO_AUTH_TOKEN;

if (!databaseUrl || databaseUrl.startsWith("file:")) {
  console.error("DATABASE_URL must be a real libsql://... URL (not a local file:), got:", databaseUrl);
  process.exit(1);
}
if (!authToken || authToken.startsWith("REPLACE_WITH_")) {
  console.error("TURSO_AUTH_TOKEN is missing or still a placeholder.");
  process.exit(1);
}

const client = createClient({ url: databaseUrl, authToken });

async function main() {
  await client.execute(
    "CREATE TABLE IF NOT EXISTS _manual_migrations (name TEXT PRIMARY KEY, applied_at TEXT NOT NULL)"
  );

  const migrationsDir = path.join(__dirname, "..", "prisma", "migrations");
  const migrationNames = readdirSync(migrationsDir, { withFileTypes: true })
    .filter((entry) => entry.isDirectory())
    .map((entry) => entry.name)
    .sort();

  const applied = new Set(
    (await client.execute("SELECT name FROM _manual_migrations")).rows.map((row) => row.name)
  );

  for (const name of migrationNames) {
    if (applied.has(name)) {
      console.log(`skip (already applied): ${name}`);
      continue;
    }

    const sqlPath = path.join(migrationsDir, name, "migration.sql");
    const sql = readFileSync(sqlPath, "utf8");

    console.log(`applying: ${name}`);
    await client.executeMultiple(sql);
    await client.execute({
      sql: "INSERT INTO _manual_migrations (name, applied_at) VALUES (?, ?)",
      args: [name, new Date().toISOString()],
    });
    console.log(`applied: ${name}`);
  }

  console.log("\nDone -- Turso database is up to date.");
}

main()
  .catch((err) => {
    console.error("Migration failed:", err);
    process.exitCode = 1;
  })
  .finally(() => client.close());
