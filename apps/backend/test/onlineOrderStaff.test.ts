import crypto from "node:crypto";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import request from "supertest";
import { buildApp } from "../src/app";
import { prisma } from "../src/prisma";
import {
  FIXTURE_PASSWORD,
  addCashier,
  addKhqrSetup,
  addProduct,
  jsonResponse,
  resetDatabase,
  seedFixtures,
} from "./helpers";

const app = buildApp();

beforeEach(async () => {
  await resetDatabase();
});

afterEach(() => {
  vi.unstubAllGlobals();
});

async function login(email: string, password: string) {
  const res = await request(app).post("/api/auth/login").send({ email, password });
  return res.body.accessToken as string;
}

async function setup() {
  const { store } = await seedFixtures();
  await prisma.storeSetting.create({ data: { storeId: store.id, key: "exchange_rate", value: "4000" } });
  const { product: rice, storeProduct } = await addProduct(store.id, {
    name: "Jasmine Rice 5kg",
    price: 6.5,
    stock: 10,
  });
  await prisma.storeProduct.update({ where: { id: storeProduct.id }, data: { costPriceMinor: 500 } });
  const admin = await login("admin@test.local", FIXTURE_PASSWORD);
  return { store, rice, admin };
}

async function place(storeId: string, productId: string, paymentMethod: "KHQR" | "PAY_AT_COUNTER" = "PAY_AT_COUNTER") {
  const res = await request(app)
    .post(`/api/public/stores/${storeId}/orders`)
    .send({
      clientOrderUuid: crypto.randomUUID(),
      items: [{ productId, quantity: 2 }],
      customerName: "Dara",
      customerPhone: "012 345 678",
      pickupAt: null,
      paymentMethod,
    });
  expect(res.status).toBe(201);
  return prisma.onlineOrder.findUniqueOrThrow({ where: { publicToken: res.body.token } });
}

const post = (token: string, url: string, body: object = {}) =>
  request(app).post(url).set("Authorization", `Bearer ${token}`).send(body);

describe("staff online order endpoints", () => {
  it("lists open orders with the full phone number, newest first", async () => {
    const { store, rice, admin } = await setup();
    const first = await place(store.id, rice.id);
    const second = await place(store.id, rice.id);

    const res = await request(app).get(`/api/stores/${store.id}/online-orders`).set("Authorization", `Bearer ${admin}`);
    expect(res.status).toBe(200);
    expect(res.body.map((o: { id: string }) => o.id)).toEqual([second.id, first.id]);
    expect(res.body[0]).toMatchObject({
      customerPhone: "012345678",
      status: "CONFIRMED",
      collectedPaymentMethod: null,
    });
    expect(res.body[0]).not.toHaveProperty("khqr");

    expect((await request(app).get(`/api/stores/${store.id}/online-orders`)).status).toBe(401);
  });

  it("walks a pay-at-counter order through ready and collected", async () => {
    const { store, rice, admin } = await setup();
    const order = await place(store.id, rice.id);
    const base = `/api/stores/${store.id}/online-orders/${order.id}`;

    const ready = await post(admin, `${base}/ready`);
    expect(ready.status).toBe(200);
    expect(ready.body.status).toBe("READY");
    expect(ready.body.readyAt).not.toBeNull();

    // A pay-at-counter order must record how it was paid.
    expect((await post(admin, `${base}/collect`)).status).toBe(400);
    const collected = await post(admin, `${base}/collect`, { paymentMethod: "CASH" });
    expect(collected.status).toBe(200);
    expect(collected.body).toMatchObject({ status: "COLLECTED", collectedPaymentMethod: "CASH" });

    // Terminal states can't move again, and collection never touched stock a second time.
    expect((await post(admin, `${base}/ready`)).status).toBe(409);
    expect((await post(admin, `${base}/collect`, { paymentMethod: "CASH" })).status).toBe(409);
    expect((await post(admin, `${base}/cancel`)).status).toBe(409);
    const stock = await prisma.storeProduct.findFirstOrThrow({ where: { storeId: store.id, productId: rice.id } });
    expect(stock.stock).toBe(8);
  });

  it("won't mark an unpaid KHQR order ready or collect it", async () => {
    const { store, rice, admin } = await setup();
    await addKhqrSetup(store.id);
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(jsonResponse({ responseCode: 1 })));
    const order = await place(store.id, rice.id, "KHQR");
    const base = `/api/stores/${store.id}/online-orders/${order.id}`;
    expect((await post(admin, `${base}/ready`)).status).toBe(409);
    expect((await post(admin, `${base}/collect`)).status).toBe(409);
  });

  it("lets a manager cancel, releasing stock, but not a cashier", async () => {
    const { store, rice, admin } = await setup();
    const cashier = await addCashier(store.id, "5678");
    const cashierToken = await login(cashier.email, "unused-password");
    const order = await place(store.id, rice.id);
    const base = `/api/stores/${store.id}/online-orders/${order.id}`;

    expect((await post(cashierToken, `${base}/cancel`)).status).toBe(403);
    // Cashiers can still run the counter.
    expect((await post(cashierToken, `${base}/ready`)).status).toBe(200);

    const cancelled = await post(admin, `${base}/cancel`);
    expect(cancelled.status).toBe(200);
    expect(cancelled.body).toMatchObject({ status: "CANCELLED", cancelReason: "STAFF" });
    const stock = await prisma.storeProduct.findFirstOrThrow({ where: { storeId: store.id, productId: rice.id } });
    expect(stock.stock).toBe(10);
    expect((await post(admin, `${base}/cancel`)).status).toBe(409);
  });

  it("scopes orders to their branch", async () => {
    const { store, rice, admin } = await setup();
    const other = await prisma.store.create({ data: { code: "B2", name: "Branch Two" } });
    await prisma.userStoreRole.create({
      data: {
        userId: (await prisma.user.findFirstOrThrow({ where: { email: "admin@test.local" } })).id,
        storeId: other.id,
        role: "ADMIN",
      },
    });
    const order = await place(store.id, rice.id);
    expect((await post(admin, `/api/stores/${other.id}/online-orders/${order.id}/ready`)).status).toBe(404);
  });
});

describe("collected online orders in the daily summary", () => {
  it("count on their collection day, alongside till sales, split by how they were paid", async () => {
    const { store, rice, admin } = await setup();
    const order = await place(store.id, rice.id);
    await post(admin, `/api/stores/${store.id}/online-orders/${order.id}/collect`, { paymentMethod: "CASH" });
    await place(store.id, rice.id); // placed but not collected: must not count

    const from = new Date(Date.now() - 3600_000).toISOString();
    const to = new Date(Date.now() + 3600_000).toISOString();
    const res = await request(app)
      .get(`/api/reports/daily-summary?storeId=${store.id}&date_from=${from}&date_to=${to}`)
      .set("Authorization", `Bearer ${admin}`);

    expect(res.status).toBe(200);
    const summary = res.body.byStore[0];
    expect(summary).toMatchObject({ orderCount: 1, onlineOrderCount: 1, totalRevenue: 13, grossProfit: 3 });
    expect(summary.byMethod).toEqual([{ paymentMethod: "CASH", count: 1, total: 13 }]);
    expect(summary.topProducts[0]).toMatchObject({
      productId: rice.id,
      name: "Jasmine Rice 5kg",
      totalQty: 2,
      revenue: 13,
    });
    expect(res.body.combined).toMatchObject({ orderCount: 1, onlineOrderCount: 1 });

    // A day that doesn't include the collection doesn't see it.
    const yesterday = await request(app)
      .get(
        `/api/reports/daily-summary?storeId=${store.id}&date_from=${new Date(Date.now() - 48 * 3600_000).toISOString()}&date_to=${from}`
      )
      .set("Authorization", `Bearer ${admin}`);
    expect(yesterday.body.byStore[0]).toMatchObject({ orderCount: 0, onlineOrderCount: 0 });
  });
});
