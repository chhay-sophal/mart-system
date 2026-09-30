import type { OnlineOrderStatus, PaymentMethod } from "@prisma/client";
import type { StaffOnlineOrder } from "@mart-system/shared-types";
import { prisma } from "../../prisma";
import { badRequest, conflict, notFound } from "../../lib/httpError";
import { ORDER_INCLUDE, type OrderWithItems } from "./onlineOrders.include";
import { releaseStock, settleOnlineOrder } from "./onlineOrderLifecycle";
import { toPublicOrder } from "./onlineOrders.service";

/** Staff-side view and transitions for IMS (build step 5). See docs/online-orders-plan.md. */

const OPEN: OnlineOrderStatus[] = ["AWAITING_PAYMENT", "CONFIRMED", "READY"];
const LIST_LIMIT = 200;

export function toStaffOrder(order: OrderWithItems): StaffOnlineOrder {
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  const { khqr, customerPhoneLast3, ...rest } = toPublicOrder(order);
  return {
    ...rest,
    id: order.id,
    customerPhone: order.customerPhone,
    collectedPaymentMethod: order.collectedPaymentMethod,
  };
}

export async function listStaffOnlineOrders(
  storeId: string,
  filter: { status?: OnlineOrderStatus | "OPEN" },
  now = new Date()
): Promise<StaffOnlineOrder[]> {
  const status = filter.status ?? "OPEN";
  const rows = await prisma.onlineOrder.findMany({
    where: { storeId, status: status === "OPEN" ? { in: OPEN } : status },
    include: ORDER_INCLUDE,
    orderBy: { createdAt: "desc" },
    take: LIST_LIMIT,
  });
  // Staff should never see (or act on) an order that has quietly expired.
  const settled = await Promise.all(rows.map((row) => settleOnlineOrder(row, now)));
  return settled.filter((order) => status !== "OPEN" || OPEN.includes(order.status)).map(toStaffOrder);
}

async function getSettled(storeId: string, orderId: string, now: Date) {
  const order = await prisma.onlineOrder.findUnique({ where: { id: orderId }, include: ORDER_INCLUDE });
  if (!order || order.storeId !== storeId) throw notFound("Order not found");
  return settleOnlineOrder(order, now);
}

/**
 * Applies a status change only if the order is still in one of `from` — the
 * same conditional-update claim the lifecycle uses — so two staff clicking at
 * once, or a click racing the sweep, can't both succeed.
 */
async function transition(
  order: OrderWithItems,
  from: OnlineOrderStatus[],
  data: Parameters<typeof prisma.onlineOrder.updateMany>[0]["data"],
  what: string
) {
  if (!from.includes(order.status)) throw conflict(`Can't ${what} an order that is ${order.status.toLowerCase()}`);
  const res = await prisma.onlineOrder.updateMany({ where: { id: order.id, status: { in: from } }, data });
  if (res.count === 0) throw conflict(`Can't ${what} this order any more — it just changed`);
  return prisma.onlineOrder.findUniqueOrThrow({ where: { id: order.id }, include: ORDER_INCLUDE });
}

export async function markOnlineOrderReady(storeId: string, orderId: string, now = new Date()) {
  const order = await getSettled(storeId, orderId, now);
  // An unpaid KHQR order isn't a real order yet; don't pack it.
  return toStaffOrder(await transition(order, ["CONFIRMED"], { status: "READY", readyAt: now }, "mark ready"));
}

export async function collectOnlineOrder(
  storeId: string,
  orderId: string,
  input: { paymentMethod?: PaymentMethod },
  now = new Date()
) {
  const order = await getSettled(storeId, orderId, now);
  let collectedPaymentMethod: PaymentMethod | null = null;
  if (order.paymentMethod === "PAY_AT_COUNTER") {
    if (!input.paymentMethod) throw badRequest("Record how the shopper paid at the counter");
    collectedPaymentMethod = input.paymentMethod;
  }
  const updated = await transition(
    order,
    ["CONFIRMED", "READY"],
    { status: "COLLECTED", collectedAt: now, collectedPaymentMethod },
    "collect"
  );
  return toStaffOrder(updated);
}

export async function cancelOnlineOrderByStaff(storeId: string, orderId: string, now = new Date()) {
  const order = await getSettled(storeId, orderId, now);
  if (!OPEN.includes(order.status)) throw conflict(`Can't cancel an order that is ${order.status.toLowerCase()}`);
  const done = await releaseStock(order, OPEN, "CANCELLED", now, "STAFF");
  if (!done) throw conflict("Can't cancel this order any more — it just changed");
  return toStaffOrder(await prisma.onlineOrder.findUniqueOrThrow({ where: { id: order.id }, include: ORDER_INCLUDE }));
}
