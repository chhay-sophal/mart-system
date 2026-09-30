import crypto from "node:crypto";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { prisma } from "../src/prisma";
import { placeOnlineOrder, getOnlineOrderByToken } from "../src/modules/onlineOrders/onlineOrders.service";
import { placeOnlineOrderSchema } from "../src/modules/onlineOrders/onlineOrders.schema";
import { settleOnlineOrder, sweepOnlineOrders } from "../src/modules/onlineOrders/onlineOrderLifecycle";
import { addKhqrSetup, addProduct, jsonResponse, resetDatabase, seedFixtures } from "./helpers";

beforeEach(async () => {
  await resetDatabase();
});

afterEach(() => {
  vi.unstubAllGlobals();
});

const MIN = 60_000;

async function setup() {
  const { store } = await seedFixtures();
  await addKhqrSetup(store.id);
  const { product } = await addProduct(store.id, { name: "Jasmine Rice 5kg", price: 6.5, stock: 10 });
  return { store, product };
}

function place(storeId: string, productId: string, paymentMethod: "KHQR" | "PAY_AT_COUNTER", now: Date) {
  const input = placeOnlineOrderSchema.parse({
    clientOrderUuid: crypto.randomUUID(),
    items: [{ productId, quantity: 2 }],
    customerName: "Dara",
    customerPhone: "012345678",
    pickupAt: null,
    paymentMethod,
  });
  return placeOnlineOrder(storeId, input, now);
}

const stockOf = async (storeId: string, productId: string) =>
  (await prisma.storeProduct.findUniqueOrThrow({ where: { storeId_productId: { storeId, productId } } })).stock;
const released = () => prisma.stockMovement.count({ where: { reason: "ONLINE_ORDER_RELEASED" } });

describe("KHQR expiry", () => {
  it("expires an unpaid order after its QR does and gives the stock back", async () => {
    const { store, product } = await setup();
    const now = new Date();
    const order = await place(store.id, product.id, "KHQR", now);
    expect(await stockOf(store.id, product.id)).toBe(8);
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(jsonResponse({ responseCode: 1 })));

    // Still inside the 5 minutes: nothing happens.
    expect((await settleOnlineOrder(order, new Date(now.getTime() + 4 * MIN))).status).toBe("AWAITING_PAYMENT");

    const after = await getOnlineOrderByToken(order.publicToken, new Date(now.getTime() + 5 * MIN + 1000));
    expect(after.status).toBe("EXPIRED");
    expect(await stockOf(store.id, product.id)).toBe(10);
    expect(await released()).toBe(1);
    expect((await prisma.paymentTransaction.findFirstOrThrow({ where: { onlineOrderId: order.id } })).status).toBe(
      "EXPIRED"
    );
  });

  it("confirms instead if the payment landed at the last second", async () => {
    const { store, product } = await setup();
    const now = new Date();
    const order = await place(store.id, product.id, "KHQR", now);
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(jsonResponse({ responseCode: 0 })));

    const after = await settleOnlineOrder(order, new Date(now.getTime() + 6 * MIN));
    expect(after.status).toBe("CONFIRMED");
    expect(await stockOf(store.id, product.id)).toBe(8);
    expect(await released()).toBe(0);
  });

  it("holds the order while Bakong is unreachable, then expires it after a grace period", async () => {
    const { store, product } = await setup();
    const now = new Date();
    const order = await place(store.id, product.id, "KHQR", now);
    vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new Error("network down")));

    expect((await settleOnlineOrder(order, new Date(now.getTime() + 8 * MIN))).status).toBe("AWAITING_PAYMENT");
    expect(await stockOf(store.id, product.id)).toBe(8);

    expect((await settleOnlineOrder(order, new Date(now.getTime() + 16 * MIN))).status).toBe("EXPIRED");
    expect(await stockOf(store.id, product.id)).toBe(10);
  });
});

describe("uncollected pay-at-counter orders", () => {
  it("are cancelled after the hold window, with stock back", async () => {
    const { store, product } = await setup();
    const now = new Date();
    const order = await place(store.id, product.id, "PAY_AT_COUNTER", now);
    expect(order.holdUntil).toEqual(new Date(now.getTime() + 60 * MIN)); // no hours listed → counts from now

    expect((await settleOnlineOrder(order, new Date(now.getTime() + 59 * MIN))).status).toBe("CONFIRMED");
    const after = await settleOnlineOrder(order, new Date(now.getTime() + 61 * MIN));
    expect(after).toMatchObject({ status: "CANCELLED", cancelReason: "UNCOLLECTED" });
    expect(await stockOf(store.id, product.id)).toBe(10);
  });

  it("never touches a paid KHQR order, however late", async () => {
    const { store, product } = await setup();
    const now = new Date();
    const order = await place(store.id, product.id, "KHQR", now);
    await prisma.onlineOrder.update({ where: { id: order.id }, data: { status: "CONFIRMED", paidAt: now } });

    expect(await sweepOnlineOrders(new Date(now.getTime() + 7 * 24 * 60 * MIN))).toBe(0);
    expect((await prisma.onlineOrder.findUniqueOrThrow({ where: { id: order.id } })).status).toBe("CONFIRMED");
    expect(await stockOf(store.id, product.id)).toBe(8);
  });
});

describe("the sweep", () => {
  it("settles overdue orders across stores and releases stock exactly once under concurrency", async () => {
    const { store, product } = await setup();
    const now = new Date();
    const khqr = await place(store.id, product.id, "KHQR", now);
    const counter = await place(store.id, product.id, "PAY_AT_COUNTER", now);
    expect(await stockOf(store.id, product.id)).toBe(6);
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(jsonResponse({ responseCode: 1 })));

    const later = new Date(now.getTime() + 2 * 60 * MIN);
    // Two sweeps and a shopper's poll all racing over the same two overdue orders.
    await Promise.all([
      sweepOnlineOrders(later),
      sweepOnlineOrders(later),
      getOnlineOrderByToken(khqr.publicToken, later),
      getOnlineOrderByToken(counter.publicToken, later),
    ]);

    expect(await stockOf(store.id, product.id)).toBe(10);
    expect(await released()).toBe(2);
    const statuses = await prisma.onlineOrder.findMany({ select: { status: true }, orderBy: { paymentMethod: "asc" } });
    expect(statuses.map((s) => s.status)).toEqual(["EXPIRED", "CANCELLED"]);
    // Nothing left to do on the next run.
    expect(await sweepOnlineOrders(later)).toBe(0);
  });
});
