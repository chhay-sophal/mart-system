import { beforeEach, describe, expect, it } from "vitest";
import request from "supertest";
import { buildApp } from "../src/app";
import { prisma } from "../src/prisma";
import { FIXTURE_PASSWORD, addProduct, resetDatabase, seedFixtures } from "./helpers";
import { toMinorUnits } from "../src/lib/money";

const app = buildApp();

beforeEach(async () => {
  await resetDatabase();
});

async function loginAsAdmin() {
  const res = await request(app)
    .post("/api/auth/login")
    .send({ email: "admin@test.local", password: FIXTURE_PASSWORD });
  return res.body.accessToken as string;
}

describe("GET /api/reports/negative-stock", () => {
  it("lists only products whose stock has gone negative, with recent movement context", async () => {
    const { store } = await seedFixtures();
    const token = await loginAsAdmin();

    const { product: negativeProduct } = await addProduct(store.id, {
      name: "Oversold Widget",
      price: 1,
      stock: -3,
    });
    await addProduct(store.id, { name: "Healthy Widget", price: 1, stock: 10 });

    await prisma.stockMovement.create({
      data: { storeId: store.id, productId: negativeProduct.id, delta: -13, reason: "SALE" },
    });

    const res = await request(app)
      .get("/api/reports/negative-stock")
      .set("Authorization", `Bearer ${token}`);

    expect(res.status).toBe(200);
    expect(res.body).toHaveLength(1);
    expect(res.body[0]).toMatchObject({
      storeId: store.id,
      storeName: store.name,
      productId: negativeProduct.id,
      productName: "Oversold Widget",
      stock: -3,
    });
    expect(res.body[0].recentMovements).toHaveLength(1);
    expect(res.body[0].recentMovements[0]).toMatchObject({ delta: -13, reason: "SALE" });
  });

  it("rejects a store the caller has no access to via ?storeId=", async () => {
    await seedFixtures();
    const token = await loginAsAdmin();
    const otherStore = await prisma.store.create({ data: { code: "OTHER", name: "Other Store" } });

    const res = await request(app)
      .get(`/api/reports/negative-stock?storeId=${otherStore.id}`)
      .set("Authorization", `Bearer ${token}`);

    expect(res.status).toBe(403);
  });
});

describe("GET /api/reports/daily-summary", () => {
  it("computes revenue, payment breakdown, top products, and gross profit for a single store", async () => {
    const { store, terminal } = await seedFixtures();
    const token = await loginAsAdmin();

    const { product } = await addProduct(store.id, { name: "Widget", price: 2, stock: 100 });
    await prisma.storeProduct.update({
      where: { storeId_productId: { storeId: store.id, productId: product.id } },
      data: { costPriceMinor: toMinorUnits(1.2, "USD") },
    });

    const createOrder = (paymentMethod: string, quantity: number, priceAtSale: number) =>
      prisma.order.create({
        data: {
          storeId: store.id,
          terminalId: terminal.id,
          clientOrderUuid: `test-${paymentMethod}-${quantity}-${Math.random()}`,
          totalAmountMinor: toMinorUnits(priceAtSale * quantity, "USD"),
          currency: "USD",
          paymentMethod: paymentMethod as never,
          amountPaidUsdMinor: toMinorUnits(priceAtSale * quantity, "USD"),
          createdAt: new Date(),
          items: { create: [{ productId: product.id, quantity, priceAtSaleMinor: toMinorUnits(priceAtSale, "USD"), currency: "USD" }] },
        },
      });

    await createOrder("CASH", 3, 2);
    await createOrder("KHQR", 2, 2);

    const res = await request(app)
      .get("/api/reports/daily-summary")
      .query({
        date_from: new Date(Date.now() - 86_400_000).toISOString(),
        date_to: new Date(Date.now() + 86_400_000).toISOString(),
      })
      .set("Authorization", `Bearer ${token}`);

    expect(res.status).toBe(200);
    expect(res.body.combined).toMatchObject({ orderCount: 2, totalRevenue: 10, grossProfit: 4 });
    expect(res.body.byStore).toHaveLength(1);
    expect(res.body.byStore[0]).toMatchObject({ storeId: store.id, storeName: store.name, orderCount: 2, totalRevenue: 10 });
    expect(res.body.byStore[0].byMethod.sort((a: { paymentMethod: string }, b: { paymentMethod: string }) =>
      a.paymentMethod.localeCompare(b.paymentMethod)
    )).toEqual([
      { paymentMethod: "CASH", count: 1, total: 6 },
      { paymentMethod: "KHQR", count: 1, total: 4 },
    ]);
    expect(res.body.byStore[0].topProducts[0]).toMatchObject({ productId: product.id, name: "Widget", totalQty: 5, revenue: 10 });
  });
});

describe("POST /api/stores/:storeId/products/:productId/adjust-stock", () => {
  it("sets the corrected stock and writes an audit ADJUSTMENT ledger row", async () => {
    const { store } = await seedFixtures();
    const token = await loginAsAdmin();
    const { product } = await addProduct(store.id, { name: "Miscounted Widget", price: 1, stock: -4 });

    const res = await request(app)
      .post(`/api/stores/${store.id}/products/${product.id}/adjust-stock`)
      .set("Authorization", `Bearer ${token}`)
      .send({ correctedStock: 6 });

    expect(res.status).toBe(200);
    expect(res.body.stock).toBe(6);

    const movements = await prisma.stockMovement.findMany({ where: { storeId: store.id, productId: product.id } });
    expect(movements).toHaveLength(1);
    expect(movements[0]).toMatchObject({ delta: 10, reason: "ADJUSTMENT" });

    const noLongerNegative = await request(app)
      .get("/api/reports/negative-stock")
      .set("Authorization", `Bearer ${token}`);
    expect(noLongerNegative.body).toHaveLength(0);
  });
});
