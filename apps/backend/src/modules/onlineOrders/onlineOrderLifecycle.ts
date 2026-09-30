import type { OnlineOrderCancelReason, OnlineOrderStatus } from "@prisma/client";
import { prisma } from "../../prisma";
import { logger } from "../../lib/logger";
import { checkKhqrStatus } from "../payments/payments.service";
import { ORDER_INCLUDE, type OrderWithItems } from "./onlineOrders.include";

/**
 * Time-driven transitions: a KHQR order whose QR expired, and a pay-at-counter
 * order not collected within its hold window. Both are applied lazily whenever
 * an order is read and by a once-a-minute sweep; releaseStock's status guard
 * makes them safe to run from both, concurrently, any number of times.
 */

/** If Bakong can't be reached at expiry, keep waiting this long before expiring anyway. */
const BAKONG_UNREACHABLE_GRACE_MS = 10 * 60_000;
const SWEEP_INTERVAL_MS = 60_000;

/**
 * Moves an order out of one of `from` into `to` and gives its stock back —
 * exactly once. The conditional status update is the claim: if another
 * request or the sweep already moved the order, this one changes nothing.
 */
export async function releaseStock(
  order: OrderWithItems,
  from: OnlineOrderStatus[],
  to: "CANCELLED" | "EXPIRED",
  now: Date,
  cancelReason: OnlineOrderCancelReason | null = null
): Promise<boolean> {
  return prisma.$transaction(async (tx) => {
    const claimed = await tx.onlineOrder.updateMany({
      where: { id: order.id, status: { in: from } },
      data: { status: to, cancelReason, cancelledAt: now },
    });
    if (claimed.count === 0) return false;

    for (const item of order.items) {
      await tx.storeProduct.updateMany({
        where: { storeId: order.storeId, productId: item.productId },
        data: { stock: { increment: item.quantity } },
      });
    }
    await tx.stockMovement.createMany({
      data: order.items.map((item) => ({
        storeId: order.storeId,
        productId: item.productId,
        delta: item.quantity,
        reason: "ONLINE_ORDER_RELEASED" as const,
        refType: "OnlineOrder",
        refId: order.id,
      })),
    });
    await tx.paymentTransaction.updateMany({
      where: { onlineOrderId: order.id, status: "PENDING" },
      data: { status: "EXPIRED" },
    });
    return true;
  });
}

async function expireUnpaidKhqr(order: OrderWithItems, now: Date) {
  if (order.status !== "AWAITING_PAYMENT" || !order.paymentExpiresAt || now < order.paymentExpiresAt) return;
  const pending = order.paymentTransactions.find((t) => t.status === "PENDING");

  // A payment can land in the last seconds before expiry, after the shopper's
  // final poll — ask Bakong once more before giving the stock away.
  if (pending) {
    try {
      if ((await checkKhqrStatus(order.storeId, pending.md5Hash)) === "PAID") {
        await prisma.$transaction([
          prisma.onlineOrder.updateMany({
            where: { id: order.id, status: "AWAITING_PAYMENT" },
            data: { status: "CONFIRMED", paidAt: now },
          }),
          prisma.paymentTransaction.update({ where: { id: pending.id }, data: { status: "PAID" } }),
        ]);
        return;
      }
    } catch (err) {
      if (now.getTime() < order.paymentExpiresAt.getTime() + BAKONG_UNREACHABLE_GRACE_MS) {
        logger.warn(
          { err, onlineOrderId: order.id },
          "Bakong unreachable at QR expiry; holding the order a little longer"
        );
        return;
      }
      logger.error(
        { err, onlineOrderId: order.id },
        "Bakong still unreachable; expiring the order without a final check"
      );
    }
  }
  await releaseStock(order, ["AWAITING_PAYMENT"], "EXPIRED", now);
}

async function cancelUncollected(order: OrderWithItems, now: Date) {
  // Only unpaid orders: a paid KHQR order is never auto-cancelled; staff resolve it (and any refund).
  if (order.paymentMethod !== "PAY_AT_COUNTER" || !order.holdUntil || now < order.holdUntil) return;
  await releaseStock(order, ["CONFIRMED", "READY"], "CANCELLED", now, "UNCOLLECTED");
}

/** Applies any overdue time-based transition to `order`, returning its current state. */
export async function settleOnlineOrder(order: OrderWithItems, now = new Date()): Promise<OrderWithItems> {
  const before = order.status;
  await expireUnpaidKhqr(order, now);
  await cancelUncollected(order, now);
  const after = await prisma.onlineOrder.findUniqueOrThrow({ where: { id: order.id }, include: ORDER_INCLUDE });
  return after.status === before ? order : after;
}

/** Settles every overdue order across all stores. Returns how many it looked at. */
export async function sweepOnlineOrders(now = new Date()): Promise<number> {
  const due = await prisma.onlineOrder.findMany({
    where: {
      OR: [
        { status: "AWAITING_PAYMENT", paymentExpiresAt: { lte: now } },
        { paymentMethod: "PAY_AT_COUNTER", status: { in: ["CONFIRMED", "READY"] }, holdUntil: { lte: now } },
      ],
    },
    include: ORDER_INCLUDE,
    take: 200,
  });
  for (const order of due) {
    try {
      await settleOnlineOrder(order, now);
    } catch (err) {
      logger.error({ err, onlineOrderId: order.id }, "Failed to settle online order during sweep");
    }
  }
  return due.length;
}

/**
 * Runs the sweep every minute. On Render's free tier the process sleeps when
 * idle, so this can run late — reads settle orders lazily regardless, and
 * the first sweep after waking catches up.
 */
export function startOnlineOrderSweep() {
  const run = () => sweepOnlineOrders().catch((err) => logger.error({ err }, "Online order sweep failed"));
  void run();
  const timer = setInterval(run, SWEEP_INTERVAL_MS);
  timer.unref();
  return timer;
}
