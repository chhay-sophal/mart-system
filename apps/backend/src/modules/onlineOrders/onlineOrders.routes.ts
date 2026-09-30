import { Router } from "express";
import { z } from "zod";
import { asyncHandler } from "../../middleware/asyncHandler";
import { requireAccessToken } from "../../middleware/requireAccessToken";
import { requireRole } from "../../middleware/requireRole";
import {
  cancelOnlineOrderByStaff,
  collectOnlineOrder,
  listStaffOnlineOrders,
  markOnlineOrderReady,
} from "./onlineOrderStaff";

/** Staff routes for online orders (the shopper-facing ones live in public.routes.ts). */
export const onlineOrdersRouter: Router = Router();

const ANY_ROLE = ["CASHIER", "INVENTORY", "ADMIN"] as const;
const MANAGE_ROLES = ["INVENTORY", "ADMIN"] as const;

const listQuerySchema = z.object({
  status: z.enum(["OPEN", "AWAITING_PAYMENT", "CONFIRMED", "READY", "COLLECTED", "CANCELLED", "EXPIRED"]).optional(),
});
const collectSchema = z.object({ paymentMethod: z.enum(["CASH", "KHQR", "CARD"]).optional() });

onlineOrdersRouter.get(
  "/stores/:storeId/online-orders",
  requireAccessToken,
  requireRole([...ANY_ROLE]),
  asyncHandler(async (req, res) => {
    res.json(await listStaffOnlineOrders(req.params.storeId!, listQuerySchema.parse(req.query)));
  })
);

onlineOrdersRouter.post(
  "/stores/:storeId/online-orders/:orderId/ready",
  requireAccessToken,
  requireRole([...ANY_ROLE]),
  asyncHandler(async (req, res) => {
    res.json(await markOnlineOrderReady(req.params.storeId!, req.params.orderId!));
  })
);

onlineOrdersRouter.post(
  "/stores/:storeId/online-orders/:orderId/collect",
  requireAccessToken,
  requireRole([...ANY_ROLE]),
  asyncHandler(async (req, res) => {
    res.json(await collectOnlineOrder(req.params.storeId!, req.params.orderId!, collectSchema.parse(req.body ?? {})));
  })
);

onlineOrdersRouter.post(
  "/stores/:storeId/online-orders/:orderId/cancel",
  requireAccessToken,
  requireRole([...MANAGE_ROLES]),
  asyncHandler(async (req, res) => {
    res.json(await cancelOnlineOrderByStaff(req.params.storeId!, req.params.orderId!));
  })
);
