import { Router } from "express";
import { asyncHandler } from "../../middleware/asyncHandler";
import { requireAccessToken } from "../../middleware/requireAccessToken";
import { dailySummaryQuerySchema, negativeStockQuerySchema } from "./reports.schema";
import { getDailySummary, listNegativeStock } from "./reports.service";

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

reportsRouter.get(
  "/reports/daily-summary",
  requireAccessToken,
  asyncHandler(async (req, res) => {
    const { storeId, date_from, date_to } = dailySummaryQuerySchema.parse(req.query);
    res.json(await getDailySummary(req.user!, { storeId, dateFrom: new Date(date_from), dateTo: new Date(date_to) }));
  })
);
