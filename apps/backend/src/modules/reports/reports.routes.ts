import { Router } from "express";
import { asyncHandler } from "../../middleware/asyncHandler";
import { requireAccessToken } from "../../middleware/requireAccessToken";
import { negativeStockQuerySchema } from "./reports.schema";
import { listNegativeStock } from "./reports.service";

export const reportsRouter: Router = Router();

// No requireRole here — a report can span multiple stores, and requireRole only
// resolves a single storeId from params/body. Access is checked per-store inside
// the service instead (resolveAccessibleStoreIds), same list a user sees at GET /api/stores.
reportsRouter.get(
  "/reports/negative-stock",
  requireAccessToken,
  asyncHandler(async (req, res) => {
    const { storeId } = negativeStockQuerySchema.parse(req.query);
    res.json(await listNegativeStock(req.user!, storeId));
  })
);
