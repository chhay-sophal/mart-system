import cors from "cors";
import express, { type Express } from "express";
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

  app.use(cors());
  app.use(express.json());

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
