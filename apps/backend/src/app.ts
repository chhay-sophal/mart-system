import cors from "cors";
import express, { type Express } from "express";
import { authRouter } from "./modules/auth/auth.routes";
import { storesRouter } from "./modules/stores/stores.routes";
import { productsRouter } from "./modules/products/products.routes";
import { errorHandler } from "./middleware/errorHandler";

export function buildApp(): Express {
  const app = express();

  app.use(cors());
  app.use(express.json());

  app.get("/health", (_req, res) => res.json({ ok: true }));

  app.use("/api/auth", authRouter);
  app.use("/api/stores", storesRouter);
  app.use("/api", productsRouter);

  app.use(errorHandler);

  return app;
}
