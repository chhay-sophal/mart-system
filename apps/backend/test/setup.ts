import path from "node:path";
import { config } from "dotenv";

// Runs before any test file's own imports, so env.ts (imported transitively via
// app.ts/prisma.ts) sees .env.test's values instead of the dev .env.
config({ path: path.resolve(process.cwd(), ".env.test"), override: true });
