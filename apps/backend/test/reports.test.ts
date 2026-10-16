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
    .send({ username: "admin", password: FIXTURE_PASSWORD });
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
    expect(res.body.combined).toMatchObject({
      orderCount: 2,
      totalRevenue: 10,
      totalRevenueKhr: 41000,
      avgOrderKhr: 20500,
      grossProfit: 4,
      // Profit rounds only once, at the end (nearest riel) -- no per-line
      // note-rounding to compound, so this is exactly grossProfit * rate.
      grossProfitKhr: 16400,
      mainCurrency: "USD",
    });
    expect(res.body.byStore).toHaveLength(1);
    expect(res.body.byStore[0]).toMatchObject({ storeId: store.id, storeName: store.name, orderCount: 2, totalRevenue: 10 });
    expect(res.body.byStore[0].byMethod.sort((a: { paymentMethod: string }, b: { paymentMethod: string }) =>
      a.paymentMethod.localeCompare(b.paymentMethod)
    )).toEqual([
      { paymentMethod: "CASH", count: 1, total: 6, totalKhr: 24600 },
      { paymentMethod: "KHQR", count: 1, total: 4, totalKhr: 16400 },
    ]);
    expect(res.body.byStore[0].topProducts[0]).toMatchObject({ productId: product.id, name: "Widget", totalQty: 5, revenue: 10, revenueKhr: 41000, profit: 4, profitKhr: 16400 });
  });

  it("computes gross profit and product revenue in riel using the exact stored amount, not a USD conversion", async () => {
    const { store, terminal } = await seedFixtures();
    const token = await loginAsAdmin();

    // Riel-priced product, riel cost -- both should flow through untouched,
    // not get divided then re-multiplied by the exchange rate.
    const product = await prisma.product.create({ data: { name: "Riel Widget", defaultPriceMinor: 4000, currency: "KHR" } });
    await prisma.storeProduct.create({
      data: { storeId: store.id, productId: product.id, stock: 50, costPriceMinor: 2000, currency: "KHR" },
    });

    await prisma.order.create({
      data: {
        storeId: store.id,
        terminalId: terminal.id,
        clientOrderUuid: `test-khr-${Math.random()}`,
        totalAmountMinor: 4000,
        currency: "KHR",
        paymentMethod: "CASH",
        amountPaidUsdMinor: 0,
        createdAt: new Date(),
        items: { create: [{ productId: product.id, quantity: 1, priceAtSaleMinor: 4000, currency: "KHR" }] },
      },
    });

    const res = await request(app)
      .get("/api/reports/daily-summary")
      .query({
        date_from: new Date(Date.now() - 86_400_000).toISOString(),
        date_to: new Date(Date.now() + 86_400_000).toISOString(),
      })
      .set("Authorization", `Bearer ${token}`);

    expect(res.status).toBe(200);
    // Exact riel figures: 4000 - 2000 = 2000, not a rate-derived approximation.
    expect(res.body.combined.grossProfitKhr).toBe(2000);
    expect(res.body.byStore[0].topProducts[0]).toMatchObject({ productId: product.id, revenueKhr: 4000, profit: 0.49, profitKhr: 2000 });
  });

  describe("gross profit", () => {
    const getSummary = async (token: string) =>
      request(app)
        .get("/api/reports/daily-summary")
        .query({
          date_from: new Date(Date.now() - 86_400_000).toISOString(),
          date_to: new Date(Date.now() + 86_400_000).toISOString(),
        })
        .set("Authorization", `Bearer ${token}`);

    async function widgetWithCost(storeId: string, cost: number) {
      const { product } = await addProduct(storeId, { name: "Widget", price: 2, stock: 100 });
      await prisma.storeProduct.update({
        where: { storeId_productId: { storeId, productId: product.id } },
        data: { costPriceMinor: toMinorUnits(cost, "USD") },
      });
      return product;
    }

    it("takes a sale-wide discount off profit, not just off revenue", async () => {
      const { store, terminal } = await seedFixtures();
      const token = await loginAsAdmin();
      const product = await widgetWithCost(store.id, 1.2);

      // 3 × $2 = $6 of lines, but the sale took $1 off the whole order.
      await prisma.order.create({
        data: {
          storeId: store.id,
          terminalId: terminal.id,
          clientOrderUuid: `test-sale-discount-${Math.random()}`,
          totalAmountMinor: toMinorUnits(5, "USD"),
          currency: "USD",
          paymentMethod: "CASH",
          createdAt: new Date(),
          items: { create: [{ productId: product.id, quantity: 3, priceAtSaleMinor: toMinorUnits(2, "USD"), currency: "USD" }] },
        },
      });

      const res = await getSummary(token);
      // $5 paid − 3 × $1.20 cost.
      expect(res.body.combined).toMatchObject({ totalRevenue: 5, grossProfit: 1.4, grossProfitKhr: 5740 });
      expect(res.body.byStore[0].topProducts[0]).toMatchObject({ revenue: 5, profit: 1.4 });
    });

    it("uses the cost recorded at the time of sale, not today's cost", async () => {
      const { store, terminal } = await seedFixtures();
      const token = await loginAsAdmin();
      // Cost has since gone up to $1.50; it was $1.00 when this sold.
      const product = await widgetWithCost(store.id, 1.5);

      await prisma.order.create({
        data: {
          storeId: store.id,
          terminalId: terminal.id,
          clientOrderUuid: `test-cost-snapshot-${Math.random()}`,
          totalAmountMinor: toMinorUnits(2, "USD"),
          currency: "USD",
          paymentMethod: "CASH",
          createdAt: new Date(),
          items: {
            create: [
              {
                productId: product.id,
                quantity: 1,
                priceAtSaleMinor: toMinorUnits(2, "USD"),
                currency: "USD",
                costAtSaleMinor: toMinorUnits(1, "USD"),
                costCurrency: "USD",
              },
            ],
          },
        },
      });

      const res = await getSummary(token);
      expect(res.body.combined.grossProfit).toBe(1);
    });

    it("leaves products with no cost out of gross profit and reports them", async () => {
      const { store, terminal } = await seedFixtures();
      const token = await loginAsAdmin();
      const costed = await widgetWithCost(store.id, 1.2);
      // No cost set: StoreProduct.costPriceMinor stays at its default 0.
      const { product: uncosted } = await addProduct(store.id, { name: "Mystery", price: 3, stock: 100 });

      await prisma.order.create({
        data: {
          storeId: store.id,
          terminalId: terminal.id,
          clientOrderUuid: `test-uncosted-${Math.random()}`,
          totalAmountMinor: toMinorUnits(5, "USD"),
          currency: "USD",
          paymentMethod: "CASH",
          createdAt: new Date(),
          items: {
            create: [
              { productId: costed.id, quantity: 1, priceAtSaleMinor: toMinorUnits(2, "USD"), currency: "USD" },
              { productId: uncosted.id, quantity: 1, priceAtSaleMinor: toMinorUnits(3, "USD"), currency: "USD" },
            ],
          },
        },
      });

      const res = await getSummary(token);
      // Only the costed line: $2 − $1.20. The $3 line isn't counted as all profit.
      expect(res.body.combined).toMatchObject({
        totalRevenue: 5,
        grossProfit: 0.8,
        uncostedRevenue: 3,
        uncostedRevenueKhr: 12300,
        uncostedProductCount: 1,
      });
      expect(res.body.byStore[0].uncostedProducts).toEqual([{ productId: uncosted.id, name: "Mystery", qty: 1 }]);
      expect(res.body.byStore[0].allProducts.find((p: { productId: string }) => p.productId === uncosted.id)).toMatchObject({
        profit: null,
        profitKhr: null,
        uncostedQty: 1,
      });
    });

    it("converts each sale at the exchange rate it was made at, not today's", async () => {
      const { store, terminal } = await seedFixtures();
      const token = await loginAsAdmin();
      // Today's rate is the 4100 default; this riel sale was made at 4000.
      const product = await widgetWithCost(store.id, 1);

      await prisma.order.create({
        data: {
          storeId: store.id,
          terminalId: terminal.id,
          clientOrderUuid: `test-rate-snapshot-${Math.random()}`,
          totalAmountMinor: 8000,
          currency: "KHR",
          paymentMethod: "CASH",
          exchangeRate: 4000,
          createdAt: new Date(),
          items: { create: [{ productId: product.id, quantity: 1, priceAtSaleMinor: 8000, currency: "KHR" }] },
        },
      });

      const res = await getSummary(token);
      // 8000 ៛ = $2 at 4000; $1 cost = 4000 ៛ at that rate.
      expect(res.body.combined).toMatchObject({ totalRevenue: 2, totalRevenueKhr: 8000, grossProfit: 1, grossProfitKhr: 4000 });
    });
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
