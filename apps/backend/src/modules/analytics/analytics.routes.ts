import { Router } from "express";
import { asyncHandler } from "../../middleware/asyncHandler";
import { requireAccessToken } from "../../middleware/requireAccessToken";
import { analyticsQuerySchema } from "./analytics.schema";
import { getAnalytics } from "./analytics.service";

export const analyticsRouter: Router = Router();

// Like Reports: no requireRole (a request can span several stores); access is
// checked per store inside the service (resolveAccessibleStoreIds).
analyticsRouter.get(
  "/analytics",
  requireAccessToken,
  asyncHandler(async (req, res) => {
    const query = analyticsQuerySchema.parse(req.query);
    res.json(await getAnalytics(req.user!, query));
  })
);
