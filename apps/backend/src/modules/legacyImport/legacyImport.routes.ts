import { Router } from "express";
import { asyncHandler } from "../../middleware/asyncHandler";
import { requireAccessToken } from "../../middleware/requireAccessToken";
import { requireRole } from "../../middleware/requireRole";
import { importLegacyOrdersSchema } from "./legacyImport.schema";
import { importLegacyOrders } from "./legacyImport.service";

export const legacyImportRouter: Router = Router();

legacyImportRouter.post(
  "/stores/:storeId/legacy-import/online-pos/orders",
  requireAccessToken,
  requireRole(["ADMIN"]),
  asyncHandler(async (req, res) => {
    const { sourceId, orders } = importLegacyOrdersSchema.parse(req.body);
    res.json(await importLegacyOrders(req.params.storeId!, sourceId, orders));
  })
);
