import { Router } from "express";
import { z } from "zod";
import type { UserRole } from "@mart-system/shared-types";
import { prisma } from "../../prisma";
import { forbidden } from "../../lib/httpError";
import { asyncHandler } from "../../middleware/asyncHandler";
import { requireTerminal } from "../../middleware/requireTerminal";
import {
  cancelOnlineOrderByStaff,
  collectOnlineOrder,
  listStaffOnlineOrders,
  markOnlineOrderReady,
} from "./onlineOrderStaff";

/**
 * Online orders for a POS terminal (via its sidecar). The paired terminal's
 * device credential fixes the branch; each action also names the staff
 * member unlocked at the till (`actorUserId`, from the terminal's synced PIN
 * roster), whose role at that branch is checked here — the same rules as the
 * IMS routes in onlineOrders.routes.ts.
 */
export const onlineOrderTerminalRouter: Router = Router();

const MANAGE_ROLES: UserRole[] = ["INVENTORY", "ADMIN"];

const listQuerySchema = z.object({
  status: z.enum(["OPEN", "AWAITING_PAYMENT", "CONFIRMED", "READY", "COLLECTED", "CANCELLED", "EXPIRED"]).optional(),
});
const actorSchema = z.object({ actorUserId: z.string().min(1) });
const collectSchema = actorSchema.extend({ paymentMethod: z.enum(["CASH", "KHQR", "CARD"]).optional() });

async function assertActor(storeId: string, userId: string, allowed?: UserRole[]) {
  const role = await prisma.userStoreRole.findUnique({
    where: { userId_storeId: { userId, storeId } },
    include: { user: { select: { isActive: true } } },
  });
  if (!role || !role.isActive || !role.user.isActive) throw forbidden("That staff member isn't active at this branch");
  if (allowed && !allowed.includes(role.role)) throw forbidden("Only inventory staff and admins can cancel online orders");
}

onlineOrderTerminalRouter.get(
  "/terminal/online-orders",
  requireTerminal,
  asyncHandler(async (req, res) => {
    res.json(await listStaffOnlineOrders(req.terminal!.storeId, listQuerySchema.parse(req.query)));
  })
);

onlineOrderTerminalRouter.post(
  "/terminal/online-orders/:orderId/ready",
  requireTerminal,
  asyncHandler(async (req, res) => {
    const { actorUserId } = actorSchema.parse(req.body);
    await assertActor(req.terminal!.storeId, actorUserId);
    res.json(await markOnlineOrderReady(req.terminal!.storeId, req.params.orderId!));
  })
);

onlineOrderTerminalRouter.post(
  "/terminal/online-orders/:orderId/collect",
  requireTerminal,
  asyncHandler(async (req, res) => {
    const { actorUserId, paymentMethod } = collectSchema.parse(req.body);
    await assertActor(req.terminal!.storeId, actorUserId);
    res.json(await collectOnlineOrder(req.terminal!.storeId, req.params.orderId!, { paymentMethod }));
  })
);

onlineOrderTerminalRouter.post(
  "/terminal/online-orders/:orderId/cancel",
  requireTerminal,
  asyncHandler(async (req, res) => {
    const { actorUserId } = actorSchema.parse(req.body);
    await assertActor(req.terminal!.storeId, actorUserId, MANAGE_ROLES);
    res.json(await cancelOnlineOrderByStaff(req.terminal!.storeId, req.params.orderId!));
  })
);
