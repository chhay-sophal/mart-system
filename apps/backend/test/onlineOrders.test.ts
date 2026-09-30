import crypto from "node:crypto";
import { beforeEach, describe, expect, it } from "vitest";
import request from "supertest";
import type { OpeningHours } from "@mart-system/shared-types";
import { buildApp } from "../src/app";
import { prisma } from "../src/prisma";
import { zonedInstant } from "../src/lib/hours";
import { placeOnlineOrder } from "../src/modules/onlineOrders/onlineOrders.service";
import { placeOnlineOrderSchema } from "../src/modules/onlineOrders/onlineOrders.schema";
import { addProduct, resetDatabase, seedFixtures } from "./helpers";

const app = buildApp();

beforeEach(async () => {
  await resetDatabase();
});

const ALL_DAY: OpeningHours = Object.fromEntries(
  ["mon", "tue", "wed", "thu", "fri", "sat", "sun"].map((d) => [d, { open: "00:00", close: "24:00" }])
) as OpeningHours;

function orderBody(items: Array<{ productId: string; quantity: number }>, extra: Record<string, unknown> = {}) {
  return {
    clientOrderUuid: crypto.randomUUID(),
    items,
    customerName: "Dara",
    customerPhone: "012 345 678",
    note: "Ring the bell",
    pickupAt: null,
    paymentMethod: "PAY_AT_COUNTER",
    ...extra,
  };
}

const stockOf = async (storeId: string, productId: string) =>
  (await prisma.storeProduct.findUniqueOrThrow({ where: { storeId_productId: { storeId, productId } } })).stock;

describe("placing an online order", () => {
  it("prices on the server, converts KHR, reserves stock and records movements", async () => {
    const { store } = await seedFixtures();
    await prisma.storeSetting.create({ data: { storeId: store.id, key: "exchange_rate", value: "4000" } });
    const { product: rice } = await addProduct(store.id, { name: "Jasmine Rice 5kg", price: 6.5, stock: 10 });
    const snack = await prisma.product.create({ data: { name: "Local Snack", defaultPriceMinor: 2000, currency: "KHR" } });
    await prisma.storeProduct.create({ data: { storeId: store.id, productId: snack.id, stock: 5, currency: "KHR" } });

    const res = await request(app)
      .post(`/api/public/stores/${store.id}/orders`)
      // A price sent by the client is ignored — schema strips unknown keys.
      .send(orderBody([{ productId: rice.id, quantity: 2, price: 0.01 } as never, { productId: snack.id, quantity: 1 }]));

    expect(res.status).toBe(201);
    expect(res.body).toMatchObject({
      storeId: store.id,
      storeName: "Test Store",
      status: "CONFIRMED",
      paymentMethod: "PAY_AT_COUNTER",
      customerName: "Dara",
      customerPhoneLast3: "678",
      note: "Ring the bell",
      totalAmount: 13.5, // 2 × $6.50 + ៛2,000 at 4,000/USD
      currency: "USD",
      exchangeRate: 4000,
      khqr: null,
    });
    expect(res.body.pickupCode).toMatch(/^[ABCDEFGHJKMNPQRSTUVWXYZ23456789]{6}$/);
    expect(res.body.token).toMatch(/^[A-Za-z0-9_-]{22}$/);
    expect(res.body.items).toEqual(
      expect.arrayContaining([
        { productId: rice.id, name: "Jasmine Rice 5kg", quantity: 2, price: 6.5, currency: "USD" },
        { productId: snack.id, name: "Local Snack", quantity: 1, price: 2000, currency: "KHR" },
      ])
    );
    // The full phone number never leaves the backend on the public view.
    expect(JSON.stringify(res.body)).not.toContain("012345678");

    expect(await stockOf(store.id, rice.id)).toBe(8);
    expect(await stockOf(store.id, snack.id)).toBe(4);
    const movements = await prisma.stockMovement.findMany({ where: { reason: "ONLINE_ORDER" } });
    expect(movements.map((m) => m.delta).sort((a, b) => a - b)).toEqual([-2, -1]);
    expect(movements.every((m) => m.refType === "OnlineOrder")).toBe(true);

    const view = await request(app).get(`/api/public/orders/${res.body.token}`);
    expect(view.status).toBe(200);
    expect(view.body.pickupCode).toBe(res.body.pickupCode);
  });

  it("rejects a short order without reserving anything", async () => {
    const { store } = await seedFixtures();
    const { product: rice } = await addProduct(store.id, { name: "Jasmine Rice 5kg", price: 6.5, stock: 10 });
    const { product: milk } = await addProduct(store.id, { name: "Fresh Milk 1L", price: 1.7, stock: 2 });

    const res = await request(app)
      .post(`/api/public/stores/${store.id}/orders`)
      .send(orderBody([{ productId: rice.id, quantity: 3 }, { productId: milk.id, quantity: 5 }]));

    expect(res.status).toBe(409);
    expect(res.body.shortages).toEqual([{ productId: milk.id, name: "Fresh Milk 1L", available: 2 }]);
    expect(await stockOf(store.id, rice.id)).toBe(10);
    expect(await stockOf(store.id, milk.id)).toBe(2);
    expect(await prisma.onlineOrder.count()).toBe(0);
    expect(await prisma.stockMovement.count({ where: { reason: "ONLINE_ORDER" } })).toBe(0);
  });

  it("merges duplicate lines before checking stock", async () => {
    const { store } = await seedFixtures();
    const { product } = await addProduct(store.id, { name: "Eggs", price: 1.8, stock: 5 });
    const res = await request(app)
      .post(`/api/public/stores/${store.id}/orders`)
      .send(orderBody([{ productId: product.id, quantity: 3 }, { productId: product.id, quantity: 3 }]));
    expect(res.status).toBe(409);
    expect(await stockOf(store.id, product.id)).toBe(5);
  });

  it("refuses products the branch doesn't sell, or that were deleted", async () => {
    const { store } = await seedFixtures();
    const { product } = await addProduct(store.id, { name: "Discontinued", price: 1, stock: 5 });
    await prisma.product.update({ where: { id: product.id }, data: { isDeleted: true } });
    const res = await request(app)
      .post(`/api/public/stores/${store.id}/orders`)
      .send(orderBody([{ productId: product.id, quantity: 1 }]));
    expect(res.status).toBe(409);
    expect(res.body.shortages[0]).toMatchObject({ productId: product.id, available: 0 });
    expect(await stockOf(store.id, product.id)).toBe(5);
  });

  it("returns the same order for a retried or concurrent submit, reserving stock once", async () => {
    const { store } = await seedFixtures();
    const { product } = await addProduct(store.id, { name: "Eggs", price: 1.8, stock: 10 });
    const body = orderBody([{ productId: product.id, quantity: 2 }]);
    const url = `/api/public/stores/${store.id}/orders`;

    const [a, b] = await Promise.all([request(app).post(url).send(body), request(app).post(url).send(body)]);
    const c = await request(app).post(url).send(body);
    expect([a.status, b.status, c.status]).toEqual([201, 201, 201]);
    expect(new Set([a.body.token, b.body.token, c.body.token]).size).toBe(1);
    expect(await prisma.onlineOrder.count()).toBe(1);
    expect(await stockOf(store.id, product.id)).toBe(8);
  });

  it("validates the request", async () => {
    const { store } = await seedFixtures();
    const { product } = await addProduct(store.id, { name: "Eggs", price: 1.8, stock: 10 });
    const url = `/api/public/stores/${store.id}/orders`;
    const line = [{ productId: product.id, quantity: 1 }];

    expect((await request(app).post(url).send(orderBody([]))).status).toBe(400);
    expect((await request(app).post(url).send(orderBody(line, { customerPhone: "12345" }))).status).toBe(400);
    expect((await request(app).post(url).send(orderBody(line, { customerName: "  " }))).status).toBe(400);
    expect((await request(app).post(url).send(orderBody([{ productId: product.id, quantity: 100 }]))).status).toBe(400);
    expect((await request(app).post(url).send(orderBody(line, { paymentMethod: "KHQR" }))).status).toBe(400);
    // No hours listed → no scheduled slots at all.
    const later = new Date(Date.now() + 2 * 3600_000).toISOString();
    expect((await request(app).post(url).send(orderBody(line, { pickupAt: later }))).status).toBe(400);

    await prisma.store.update({ where: { id: store.id }, data: { isActive: false } });
    expect((await request(app).post(url).send(orderBody(line))).status).toBe(404);
    expect(await stockOf(store.id, product.id)).toBe(10);
  });

  it("accepts Cambodian phone formats and stores them normalised", async () => {
    const { store } = await seedFixtures();
    const { product } = await addProduct(store.id, { name: "Eggs", price: 1.8, stock: 10 });
    const res = await request(app)
      .post(`/api/public/stores/${store.id}/orders`)
      .send(orderBody([{ productId: product.id, quantity: 1 }], { customerPhone: "+855 12 345 678" }));
    expect(res.status).toBe(201);
    const saved = await prisma.onlineOrder.findUniqueOrThrow({ where: { publicToken: res.body.token } });
    expect(saved.customerPhone).toBe("012345678");
  });
});

describe("pickup times and the hold window", () => {
  it("offers slots from the store's hours and accepts one", async () => {
    const { store } = await seedFixtures();
    await prisma.store.update({ where: { id: store.id }, data: { openingHours: ALL_DAY } });
    const { product } = await addProduct(store.id, { name: "Eggs", price: 1.8, stock: 10 });

    const slots = await request(app).get(`/api/public/stores/${store.id}/pickup-slots`);
    expect(slots.status).toBe(200);
    expect(slots.body.asap).toEqual({ availableNow: true, opensAt: null });
    expect(slots.body.slots.length).toBeGreaterThan(40);

    const pickupAt = slots.body.slots[0];
    const res = await request(app)
      .post(`/api/public/stores/${store.id}/orders`)
      .send(orderBody([{ productId: product.id, quantity: 1 }], { pickupAt }));
    expect(res.status).toBe(201);
    expect(res.body.pickupAt).toBe(pickupAt);
    // Default hold: 60 minutes after the chosen pickup time.
    expect(new Date(res.body.holdUntil).getTime() - new Date(pickupAt).getTime()).toBe(60 * 60_000);
  });

  it("counts the hold from the next opening for 'as soon as ready' while closed, using the store's setting", async () => {
    const { store } = await seedFixtures();
    const hours = { ...ALL_DAY, mon: { open: "07:00", close: "22:00" } };
    await prisma.store.update({ where: { id: store.id }, data: { openingHours: hours } });
    await prisma.storeSetting.create({ data: { storeId: store.id, key: "online_order_hold_minutes", value: "30" } });
    const { product } = await addProduct(store.id, { name: "Eggs", price: 1.8, stock: 10 });

    // Monday 05:00 in Phnom Penh: closed until 07:00. (Sunday is 24h, but that ended at midnight.)
    const now = zonedInstant("Asia/Phnom_Penh", 2026, 10, 5, 5, 0);
    const input = placeOnlineOrderSchema.parse(orderBody([{ productId: product.id, quantity: 1 }]));
    const order = await placeOnlineOrder(store.id, input, now);
    expect(order.holdUntil).toEqual(zonedInstant("Asia/Phnom_Penh", 2026, 10, 5, 7, 30));

    // While open, it counts from order time.
    const noon = zonedInstant("Asia/Phnom_Penh", 2026, 10, 5, 12, 0);
    const input2 = placeOnlineOrderSchema.parse(orderBody([{ productId: product.id, quantity: 1 }]));
    const order2 = await placeOnlineOrder(store.id, input2, noon);
    expect(order2.holdUntil).toEqual(new Date(noon.getTime() + 30 * 60_000));
  });
});
