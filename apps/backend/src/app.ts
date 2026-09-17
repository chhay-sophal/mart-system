import cors from "cors";
import express, { type Express } from "express";
import pinoHttp from "pino-http";
import { env } from "./env";
import { logger } from "./lib/logger";
import { authRouter } from "./modules/auth/auth.routes";
import { storesRouter } from "./modules/stores/stores.routes";
import { productsRouter } from "./modules/products/products.routes";
import { staffRouter } from "./modules/staff/staff.routes";
import { terminalsRouter } from "./modules/terminals/terminals.routes";
import { syncRouter } from "./modules/sync/sync.routes";
import { paymentsRouter } from "./modules/payments/payments.routes";
import { reportsRouter } from "./modules/reports/reports.routes";
import { stockTransfersRouter } from "./modules/stockTransfers/stockTransfers.routes";
import { errorHandler } from "./middleware/errorHandler";

export function buildApp(): Express {
  const app = express();

  // Only IMS calls this API from a browser — POS's sidecar talks to it via a
  // server-to-server fetch, never subject to CORS. Dev/test stay permissive
  // (no friction from not having CORS_ALLOWED_ORIGINS set locally); env.ts
  // already refuses to boot in production without an explicit allow-list.
  app.use(cors(env.NODE_ENV === "production" ? { origin: env.corsAllowedOrigins } : {}));
  app.use(express.json());
  // /health is polled frequently (uptime checks, dev startup probes) — excluded so it doesn't drown out real request logs.
  app.use(pinoHttp({ logger, autoLogging: { ignore: (req) => req.url === "/health" } }));

  app.get("/health", (_req, res) => res.json({ ok: true }));

  app.use("/api/auth", authRouter);
  app.use("/api/stores", storesRouter);
  app.use("/api", productsRouter);
  app.use("/api", staffRouter);
  app.use("/api", terminalsRouter);
  app.use("/api", syncRouter);
  app.use("/api", paymentsRouter);
  app.use("/api", reportsRouter);
  app.use("/api", stockTransfersRouter);

  app.use(errorHandler);

  return app;
}
