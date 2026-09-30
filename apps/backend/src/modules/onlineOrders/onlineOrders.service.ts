import crypto from "node:crypto";
import { Prisma } from "@prisma/client";
import type { OnlineOrderLine, OpeningHours, PickupSlotsResponse, PublicOnlineOrder } from "@mart-system/shared-types";
import { prisma } from "../../prisma";
import { badRequest, conflict, HttpError, notFound } from "../../lib/httpError";
import { fromMinorUnits, toMinorUnits } from "../../lib/money";
import { isOpenAt, isValidPickupSlot, nextOpening, pickupSlots } from "../../lib/hours";
import { logger } from "../../lib/logger";
import { checkKhqrStatus, generateKhqr } from "../payments/payments.service";
import type { PlaceOnlineOrderInput } from "./onlineOrders.schema";

const DEFAULT_EXCHANGE_RATE = 4100;
const DEFAULT_HOLD_MINUTES = 60;
// No 0/O, 1/I/L — read aloud at a busy counter.
const PICKUP_CODE_ALPHABET = "ABCDEFGHJKMNPQRSTUVWXYZ23456789";
const OPEN_STATUSES = ["AWAITING_PAYMENT", "CONFIRMED", "READY"] as const;
/** Matches generateKhqr's own QR expiry; stock is held for the same time. */
const KHQR_LIFETIME_MS = 5 * 60_000;
/** Many open tabs polling one order still reach Bakong at most this often. */
const PAYMENT_CHECK_INTERVAL_MS = 3_000;

export const ORDER_INCLUDE = {
  items: true,
  store: { select: { name: true } },
  paymentTransactions: { orderBy: { createdAt: "desc" } },
} as const;
export type OrderWithItems = Prisma.OnlineOrderGetPayload<{ include: typeof ORDER_INCLUDE }>;

async function getSetting(storeId: string, key: string) {
  const row = await prisma.storeSetting.findUnique({ where: { storeId_key: { storeId, key } } });
  return row?.value;
}

async function numberSetting(storeId: string, key: string, fallback: number) {
  const n = Number(await getSetting(storeId, key));
  return Number.isFinite(n) && n > 0 ? n : fallback;
}

async function getOpenStoreOrThrow(storeId: string) {
  const store = await prisma.store.findFirst({ where: { id: storeId, isActive: true } });
  if (!store) throw notFound("Store not found");
  return { ...store, openingHours: (store.openingHours as OpeningHours | null) ?? null };
}

function randomPickupCode() {
  const bytes = crypto.randomBytes(6);
  return [...bytes].map((b) => PICKUP_CODE_ALPHABET[b % PICKUP_CODE_ALPHABET.length]).join("");
}

async function uniquePickupCode(tx: Prisma.TransactionClient, storeId: string) {
  for (let attempt = 0; attempt < 10; attempt += 1) {
    const code = randomPickupCode();
    const clash = await tx.onlineOrder.findFirst({
      where: { storeId, pickupCode: code, status: { in: [...OPEN_STATUSES] } },
      select: { id: true },
    });
    if (!clash) return code;
  }
  throw new HttpError(503, "Couldn't allocate a pickup code, please try again");
}

const iso = (d: Date | null) => (d ? d.toISOString() : null);

function khqrView(order: OrderWithItems): PublicOnlineOrder["khqr"] {
  const pending = order.paymentTransactions.find((t) => t.status === "PENDING");
  if (order.status !== "AWAITING_PAYMENT" || !pending || !order.paymentExpiresAt) return null;
  return {
    qrString: pending.qrString,
    amount: fromMinorUnits(pending.amountMinor, pending.currency),
    currency: pending.currency,
    expiresAt: order.paymentExpiresAt.toISOString(),
  };
}

/** KHQR needs both halves of a branch's Bakong setup: an account to be paid into, and the email that mints status-check tokens. */
export async function isKhqrAvailable(storeId: string) {
  const [account, credential] = await Promise.all([
    getSetting(storeId, "bakong_account_id"),
    prisma.bakongCredential.findUnique({ where: { storeId } }),
  ]);
  return Boolean(account?.trim() && credential?.registeredEmail);
}

export function toPublicOrder(order: OrderWithItems): PublicOnlineOrder {
  const items: OnlineOrderLine[] = order.items.map((item) => ({
    productId: item.productId,
    name: item.nameAtOrder,
    quantity: item.quantity,
    price: fromMinorUnits(item.priceAtOrderMinor, item.currency),
    currency: item.currency,
  }));
  return {
    token: order.publicToken,
    storeId: order.storeId,
    storeName: order.store.name,
    pickupCode: order.pickupCode,
    status: order.status,
    paymentMethod: order.paymentMethod,
    customerName: order.customerName,
    customerPhoneLast3: order.customerPhone.slice(-3),
    note: order.note,
    pickupAt: iso(order.pickupAt),
    holdUntil: iso(order.holdUntil),
    items,
    totalAmount: fromMinorUnits(order.totalAmountMinor, "USD"),
    currency: "USD",
    exchangeRate: order.exchangeRate,
    khqr: khqrView(order),
    cancelReason: order.cancelReason,
    createdAt: order.createdAt.toISOString(),
    paidAt: iso(order.paidAt),
    readyAt: iso(order.readyAt),
    collectedAt: iso(order.collectedAt),
    cancelledAt: iso(order.cancelledAt),
  };
}

export async function getPickupSlots(storeId: string, now = new Date()): Promise<PickupSlotsResponse> {
  const store = await getOpenStoreOrThrow(storeId);
  const hours = store.openingHours;
  const availableNow = hours ? isOpenAt(hours, store.timezone, now) : true;
  return {
    asap: {
      availableNow,
      opensAt: hours && !availableNow ? iso(nextOpening(hours, store.timezone, now)) : null,
    },
    slots: pickupSlots(hours, store.timezone, now).map((d) => d.toISOString()),
  };
}

type Shortage = { productId: string; name: string; available: number };

/**
 * Places an order: prices from the server, stock reserved atomically (the
 * whole order or nothing), and idempotent on clientOrderUuid. A KHQR order
 * gets its QR code (and a PENDING PaymentTransaction) in the same transaction.
 */
export async function placeOnlineOrder(
  storeId: string,
  input: PlaceOnlineOrderInput,
  now = new Date()
): Promise<OrderWithItems> {
  const existing = await prisma.onlineOrder.findUnique({
    where: { clientOrderUuid: input.clientOrderUuid },
    include: ORDER_INCLUDE,
  });
  if (existing) {
    if (existing.storeId !== storeId) throw conflict("This checkout was already used for another branch");
    return existing;
  }

  const store = await getOpenStoreOrThrow(storeId);

  const pickupAt = input.pickupAt ? new Date(input.pickupAt) : null;
  if (pickupAt && !isValidPickupSlot(store.openingHours, store.timezone, pickupAt, now)) {
    throw badRequest("That pickup time isn't available any more — please choose another");
  }

  // Merge duplicate lines so one product can't dodge the per-line stock check.
  const wanted = new Map<string, number>();
  for (const item of input.items) wanted.set(item.productId, (wanted.get(item.productId) ?? 0) + item.quantity);

  const rows = await prisma.storeProduct.findMany({
    where: { storeId, productId: { in: [...wanted.keys()] } },
    include: { product: true },
  });
  const byProduct = new Map(rows.filter((r) => !r.product.isDeleted).map((r) => [r.productId, r]));

  const exchangeRate = await numberSetting(storeId, "exchange_rate", DEFAULT_EXCHANGE_RATE);
  const holdMinutes = await numberSetting(storeId, "online_order_hold_minutes", DEFAULT_HOLD_MINUTES);

  const lines = [...wanted.entries()].map(([productId, quantity]) => {
    const row = byProduct.get(productId);
    if (!row) return { productId, quantity, row: null };
    const hasOverride = row.priceOverrideMinor !== null;
    const currency = hasOverride ? row.currency : row.product.currency;
    const priceMinor = hasOverride ? row.priceOverrideMinor! : row.product.defaultPriceMinor;
    return { productId, quantity, row, currency, priceMinor };
  });

  const notSold = lines.filter((l) => !l.row);
  if (notSold.length > 0) {
    throw new HttpError(409, "Some items aren't sold at this branch", {
      shortages: notSold.map((l) => ({ productId: l.productId, name: "Unavailable item", available: 0 })),
    });
  }

  const totalUsd = lines.reduce((sum, l) => {
    const unit = fromMinorUnits(l.priceMinor!, l.currency!);
    return sum + (l.currency === "KHR" ? unit / exchangeRate : unit) * l.quantity;
  }, 0);

  // Built before any stock is touched: the SDK call is local (no network), and
  // if it fails the shopper just sees an error with nothing reserved.
  let khqr: Awaited<ReturnType<typeof generateKhqr>> | null = null;
  if (input.paymentMethod === "KHQR") {
    if (!(await isKhqrAvailable(storeId))) {
      throw badRequest("KHQR isn't set up at this branch yet — please choose to pay at the counter");
    }
    const mainCurrency = (await getSetting(storeId, "main_currency")) === "KHR" ? "KHR" : "USD";
    const amount = mainCurrency === "KHR" ? Math.round(totalUsd * exchangeRate) : Math.round(totalUsd * 100) / 100;
    khqr = await generateKhqr(storeId, { amount, currency: mainCurrency });
  }

  let holdUntil: Date | null = null;
  if (input.paymentMethod === "PAY_AT_COUNTER") {
    // "As soon as ready" while closed counts from when the branch next opens.
    const openNow = store.openingHours ? isOpenAt(store.openingHours, store.timezone, now) : true;
    const from = pickupAt ?? (openNow ? now : (nextOpening(store.openingHours!, store.timezone, now) ?? now));
    holdUntil = new Date(from.getTime() + holdMinutes * 60_000);
  }

  try {
    return await reserveAndCreate();
  } catch (err) {
    // Two identical submits racing: the loser trips clientOrderUuid's unique index. Same order either way.
    if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === "P2002") {
      const winner = await prisma.onlineOrder.findUnique({
        where: { clientOrderUuid: input.clientOrderUuid },
        include: ORDER_INCLUDE,
      });
      if (winner && winner.storeId === storeId) return winner;
    }
    throw err;
  }

  function reserveAndCreate() {
    return prisma.$transaction(async (tx) => {
      const shortages: Shortage[] = [];
      for (const l of lines) {
        // Conditional decrement: never takes stock below zero, and races with a
        // concurrent order or till sale are settled by the database, not a read-then-write.
        const res = await tx.storeProduct.updateMany({
          where: { storeId, productId: l.productId, stock: { gte: l.quantity } },
          data: { stock: { decrement: l.quantity } },
        });
        if (res.count === 0) {
          const current = await tx.storeProduct.findUnique({
            where: { storeId_productId: { storeId, productId: l.productId } },
          });
          shortages.push({
            productId: l.productId,
            name: l.row!.product.name,
            available: Math.max(0, current?.stock ?? 0),
          });
        }
      }
      // Throwing rolls back every decrement above: nothing is reserved on a short order.
      if (shortages.length > 0) throw new HttpError(409, "Some items don't have enough stock", { shortages });

      const order = await tx.onlineOrder.create({
        data: {
          storeId,
          publicToken: crypto.randomBytes(16).toString("base64url"),
          clientOrderUuid: input.clientOrderUuid,
          pickupCode: await uniquePickupCode(tx, storeId),
          // KHQR orders wait for Bakong to confirm payment (refreshKhqrPayment).
          status: input.paymentMethod === "PAY_AT_COUNTER" ? "CONFIRMED" : "AWAITING_PAYMENT",
          paymentMethod: input.paymentMethod,
          customerName: input.customerName,
          customerPhone: input.customerPhone,
          note: input.note || null,
          pickupAt,
          holdUntil,
          paymentExpiresAt: khqr ? new Date(now.getTime() + KHQR_LIFETIME_MS) : null,
          totalAmountMinor: toMinorUnits(totalUsd, "USD"),
          currency: "USD",
          exchangeRate,
          createdAt: now,
          paymentTransactions: khqr
            ? {
                create: {
                  md5Hash: khqr.md5Hash,
                  qrString: khqr.qrString,
                  currency: khqr.currency,
                  amountMinor: toMinorUnits(khqr.amount, khqr.currency),
                  status: "PENDING",
                },
              }
            : undefined,
          items: {
            create: lines.map((l) => ({
              productId: l.productId,
              nameAtOrder: l.row!.product.name,
              quantity: l.quantity,
              priceAtOrderMinor: l.priceMinor!,
              currency: l.currency!,
            })),
          },
        },
        include: ORDER_INCLUDE,
      });

      await tx.stockMovement.createMany({
        data: lines.map((l) => ({
          storeId,
          productId: l.productId,
          delta: -l.quantity,
          reason: "ONLINE_ORDER" as const,
          refType: "OnlineOrder",
          refId: order.id,
        })),
      });

      return order;
    });
  }
}

/**
 * While an order awaits KHQR payment, asks Bakong whether it's been paid —
 * at most once per PAYMENT_CHECK_INTERVAL_MS per order, however many tabs
 * are polling (the claim on lastPaymentCheckAt is a single conditional
 * update, so concurrent polls can't both win). A Bakong outage just means
 * "still waiting"; the next poll tries again.
 */
export async function refreshKhqrPayment(order: OrderWithItems, now = new Date()): Promise<OrderWithItems> {
  if (order.status !== "AWAITING_PAYMENT" || !order.paymentExpiresAt || now >= order.paymentExpiresAt) return order;
  const pending = order.paymentTransactions.find((t) => t.status === "PENDING");
  if (!pending) return order;

  const claimed = await prisma.onlineOrder.updateMany({
    where: {
      id: order.id,
      status: "AWAITING_PAYMENT",
      OR: [
        { lastPaymentCheckAt: null },
        { lastPaymentCheckAt: { lt: new Date(now.getTime() - PAYMENT_CHECK_INTERVAL_MS) } },
      ],
    },
    data: { lastPaymentCheckAt: now },
  });
  if (claimed.count === 0) return order;

  let status;
  try {
    status = await checkKhqrStatus(order.storeId, pending.md5Hash);
  } catch (err) {
    logger.warn({ err, onlineOrderId: order.id }, "Bakong status check failed; will retry on next poll");
    return order;
  }
  if (status !== "PAID") return order;

  await prisma.$transaction([
    prisma.onlineOrder.updateMany({
      where: { id: order.id, status: "AWAITING_PAYMENT" },
      data: { status: "CONFIRMED", paidAt: now },
    }),
    prisma.paymentTransaction.update({ where: { id: pending.id }, data: { status: "PAID" } }),
  ]);
  return prisma.onlineOrder.findUniqueOrThrow({ where: { id: order.id }, include: ORDER_INCLUDE });
}

export async function getOnlineOrderByToken(token: string, now = new Date()): Promise<OrderWithItems> {
  const order = await prisma.onlineOrder.findUnique({ where: { publicToken: token }, include: ORDER_INCLUDE });
  if (!order) throw notFound("Order not found");
  return refreshKhqrPayment(order, now);
}
