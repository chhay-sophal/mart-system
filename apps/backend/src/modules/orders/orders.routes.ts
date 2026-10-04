import { Router } from "express";
import { z } from "zod";
import { asyncHandler } from "../../middleware/asyncHandler";
import { requireAccessToken } from "../../middleware/requireAccessToken";
import { requireRole } from "../../middleware/requireRole";
import { listOrdersForUser, voidOrder } from "./orders.service";

export const ordersRouter: Router = Router();

const isoDate = z.string().datetime({ offset: true });

const listQuerySchema = z.object({
  // Omitted = every store the user can see ("All branches").
  storeId: z.string().min(1).optional(),
  date_from: isoDate.optional(),
  date_to: isoDate.optional(),
  limit: z.coerce.number().int().min(1).max(5000).default(2000),
});

// IMS Sales History. No requireRole -- like reports, a list can span several
// stores, so access is checked per store in the service.
ordersRouter.get(
  "/orders",
  requireAccessToken,
  asyncHandler(async (req, res) => {
    const { storeId, date_from, date_to, limit } = listQuerySchema.parse(req.query);
    res.json(
      await listOrdersForUser(req.user!, {
        storeId,
        dateFrom: date_from ? new Date(date_from) : undefined,
        dateTo: date_to ? new Date(date_to) : undefined,
        limit,
      })
    );
  })
);

ordersRouter.post(
  "/stores/:storeId/orders/:orderId/void",
  requireAccessToken,
  requireRole(["ADMIN"]),
  asyncHandler(async (req, res) => {
    res.json(await voidOrder(req.params.storeId!, req.params.orderId!));
  })
);
