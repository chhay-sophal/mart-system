import { beforeEach, describe, expect, it } from "vitest";
import request from "supertest";
import { buildApp } from "../src/app";
import { prisma } from "../src/prisma";
import { FIXTURE_PASSWORD, addProduct, resetDatabase, seedFixtures } from "./helpers";
import { toMinorUnits } from "../src/lib/money";
import { addDays, weekdayOf, zonedDateHour, zonedMidnight } from "../src/lib/zonedTime";

const app = buildApp();

beforeEach(async () => {
  await resetDatabase();
});

async function loginAsAdmin() {
  const res = await request(app).post("/api/auth/login").send({ username: "admin", password: FIXTURE_PASSWORD });
  return res.body.accessToken as string;
}

// A USD sale of `quantity` units at `price`, made at `createdAt` (UTC).
function sale(storeId: string, terminalId: string, productId: string, createdAt: string, quantity = 1, price = 2) {
  return prisma.order.create({
    data: {
      storeId,
      terminalId,
      clientOrderUuid: `test-${Math.random()}`,
      totalAmountMinor: toMinorUnits(price * quantity, "USD"),
      currency: "USD",
      paymentMethod: "CASH",
      amountPaidUsdMinor: toMinorUnits(price * quantity, "USD"),
      createdAt: new Date(createdAt),
      items: { create: [{ productId, quantity, priceAtSaleMinor: toMinorUnits(price, "USD"), currency: "USD" }] },
    },
  });
}

const analytics = (token: string, query: Record<string, string>) =>
  request(app).get("/api/analytics").query(query).set("Authorization", `Bearer ${token}`);

describe("zoned dates", () => {
  it("works in the store's own time zone", () => {
    // Phnom Penh is UTC+7: local midnight of Mar 1 is 17:00 UTC on Feb 28.
    expect(zonedMidnight("2026-03-01", "Asia/Phnom_Penh").toISOString()).toBe("2026-02-28T17:00:00.000Z");
    expect(zonedDateHour(new Date("2026-02-28T18:30:00Z"), "Asia/Phnom_Penh")).toEqual({ date: "2026-03-01", hour: 1 });
    expect(addDays("2026-03-01", -1)).toBe("2026-02-28");
    expect(weekdayOf("2026-03-01")).toBe(6); // a Sunday
  });
});

describe("GET /api/analytics", () => {
  it("totals each local day the same way Reports does, with when in the week sales happen", async () => {
    const { store, terminal } = await seedFixtures();
    const { product } = await addProduct(store.id, { name: "Widget", price: 2, stock: 100 });
    await prisma.storeProduct.update({
      where: { storeId_productId: { storeId: store.id, productId: product.id } },
      data: { costPriceMinor: toMinorUnits(1.2, "USD") },
    });
    // Local (UTC+7) times: Mar 1 09:30, Mar 1 09:50, Mar 1 23:10 -- the last is still Mar 1 locally.
    await sale(store.id, terminal.id, product.id, "2026-03-01T02:30:00Z", 3);
    await sale(store.id, terminal.id, product.id, "2026-03-01T02:50:00Z", 2);
    await sale(store.id, terminal.id, product.id, "2026-03-01T16:10:00Z", 1);
    const token = await loginAsAdmin();

    const res = await analytics(token, { from: "2026-03-01", to: "2026-03-01" });

    expect(res.status).toBe(200);
    expect(res.body.days).toEqual([{ date: "2026-03-01", orderCount: 3, revenue: 12, revenueKhr: 49200, profit: 4.8, profitKhr: 19680 }]);
    // Sunday (6): two orders at 9:00, one at 23:00.
    expect(res.body.heatmap[6][9]).toMatchObject({ orders: 2, revenue: 10 });
    expect(res.body.heatmap[6][23]).toMatchObject({ orders: 1, revenue: 2 });
    expect(res.body.previousDays).toEqual([{ date: "2026-02-28", orderCount: 0, revenue: 0, revenueKhr: 0, profit: 0, profitKhr: 0 }]);

    // Same day in Reports (local midnight to midnight): the same totals.
    const report = await request(app)
      .get("/api/reports/daily-summary")
      .query({ date_from: "2026-02-28T17:00:00.000Z", date_to: "2026-03-01T17:00:00.000Z" })
      .set("Authorization", `Bearer ${token}`);
    expect(report.body.combined).toMatchObject({ orderCount: 3, totalRevenue: 12, grossProfit: 4.8 });
  });

  it("works a day out once, and again only when one of its orders changes", async () => {
    const { store, terminal } = await seedFixtures();
    const { product } = await addProduct(store.id, { name: "Widget", price: 2, stock: 100 });
    await sale(store.id, terminal.id, product.id, "2026-03-01T03:00:00Z");
    const token = await loginAsAdmin();

    await analytics(token, { from: "2026-03-01", to: "2026-03-01" });
    const first = await prisma.dailyStoreStat.findUnique({ where: { storeId_date: { storeId: store.id, date: "2026-03-01" } } });

    // Nothing changed: the saved day is used as is.
    await analytics(token, { from: "2026-03-01", to: "2026-03-01" });
    const unchanged = await prisma.dailyStoreStat.findUnique({ where: { storeId_date: { storeId: store.id, date: "2026-03-01" } } });
    expect(unchanged?.updatedAt.getTime()).toBe(first?.updatedAt.getTime());

    // Another sale that day (e.g. synced late): the day is redone.
    await sale(store.id, terminal.id, product.id, "2026-03-01T04:00:00Z", 2);
    const res = await analytics(token, { from: "2026-03-01", to: "2026-03-01" });
    expect(res.body.days[0]).toMatchObject({ orderCount: 2, revenue: 6 });
  });

  it("redoes a day whose sale was voided", async () => {
    const { store, terminal } = await seedFixtures();
    const { product } = await addProduct(store.id, { name: "Widget", price: 2, stock: 100 });
    const order = await sale(store.id, terminal.id, product.id, "2026-03-01T03:00:00Z", 5);
    const token = await loginAsAdmin();
    expect((await analytics(token, { from: "2026-03-01", to: "2026-03-01" })).body.days[0].revenue).toBe(10);

    await prisma.order.update({ where: { id: order.id }, data: { status: "VOIDED" } });
    expect((await analytics(token, { from: "2026-03-01", to: "2026-03-01" })).body.days[0]).toMatchObject({ orderCount: 0, revenue: 0 });
  });

  it("compares products' latest four weeks with the four before", async () => {
    const { store, terminal } = await seedFixtures();
    const { product: rising } = await addProduct(store.id, { name: "Rising", price: 1, stock: 100 });
    const { product: stopped } = await addProduct(store.id, { name: "Stopped", price: 1, stock: 100 });
    // Window ends Mar 28: latest four weeks Mar 1-28, the four before Feb 1-28.
    await sale(store.id, terminal.id, rising.id, "2026-02-10T03:00:00Z", 1, 1);
    await sale(store.id, terminal.id, rising.id, "2026-03-10T03:00:00Z", 5, 1);
    await sale(store.id, terminal.id, stopped.id, "2026-02-15T03:00:00Z", 4, 1);
    const token = await loginAsAdmin();

    const res = await analytics(token, { from: "2026-03-01", to: "2026-03-28" });

    expect(res.body.movers.range).toEqual({ from: "2026-03-01", to: "2026-03-28", prevFrom: "2026-02-01", prevTo: "2026-02-28" });
    const byName = Object.fromEntries(res.body.movers.products.map((p: { name: string }) => [p.name, p]));
    expect(byName.Rising).toMatchObject({ current: { qty: 5, revenue: 5 }, previous: { qty: 1, revenue: 1 } });
    expect(byName.Stopped).toMatchObject({ current: { qty: 0, revenue: 0 }, previous: { qty: 4, revenue: 4 } });
  });

  it("rejects a store the caller can't access, and ranges that are too long or backwards", async () => {
    await seedFixtures();
    const token = await loginAsAdmin();
    const other = await prisma.store.create({ data: { code: "OTHER", name: "Other Store" } });

    expect((await analytics(token, { storeId: other.id, from: "2026-03-01", to: "2026-03-01" })).status).toBe(403);
    expect((await analytics(token, { from: "2025-01-01", to: "2026-03-01" })).status).toBe(400);
    expect((await analytics(token, { from: "2026-03-02", to: "2026-03-01" })).status).toBe(400);
    expect((await request(app).get("/api/analytics").query({ from: "2026-03-01", to: "2026-03-01" })).status).toBe(401);
  });
});
