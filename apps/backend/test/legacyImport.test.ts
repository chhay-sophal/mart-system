import { beforeEach, describe, expect, it } from "vitest";
import request from "supertest";
import { buildApp } from "../src/app";
import { prisma } from "../src/prisma";
import { zonedLocalToUtc } from "../src/modules/legacyImport/legacyImport.service";
import { FIXTURE_PASSWORD, addCashier, resetDatabase, seedFixtures } from "./helpers";

const app = buildApp();
const SOURCE = "abcdef0123456789";

beforeEach(async () => {
  await resetDatabase();
});

async function loginAsAdmin() {
  const res = await request(app).post("/api/auth/login").send({ email: "admin@test.local", password: FIXTURE_PASSWORD });
  return res.body.accessToken as string;
}

function legacyOrder(overrides: Record<string, unknown> = {}) {
  return {
    legacyId: 1,
    createdAt: "2026-07-06 21:07:44",
    paymentMethod: "CASH",
    bankName: null,
    totalAmount: 10.73,
    currency: "USD",
    amountPaidUsd: 0,
    amountPaidKhr: 44000,
    changeGivenKhr: 0,
    status: "COMPLETED",
    isDeleted: false,
    items: [{ barcode: "111", name: "Milk", quantity: 2, priceAtSale: 22000, currency: "KHR" }],
    ...overrides,
  };
}

async function importOrders(storeId: string, token: string, orders: unknown[]) {
  return request(app)
    .post(`/api/stores/${storeId}/legacy-import/online-pos/orders`)
    .set("Authorization", `Bearer ${token}`)
    .send({ sourceId: SOURCE, orders });
}

async function addKhrProduct(storeId: string, barcode: string, stock: number) {
  const product = await prisma.product.create({
    data: { name: `Product ${barcode}`, barcode, defaultPriceMinor: 22000, currency: "KHR" },
  });
  await prisma.storeProduct.create({ data: { storeId, productId: product.id, stock, currency: "KHR" } });
  return product;
}

describe("POST /api/stores/:storeId/legacy-import/online-pos/orders", () => {
  it("imports orders with items, without touching stock", async () => {
    const { store } = await seedFixtures();
    const token = await loginAsAdmin();
    const product = await addKhrProduct(store.id, "111", 7);

    const res = await importOrders(store.id, token, [
      legacyOrder(),
      legacyOrder({ legacyId: 2, paymentMethod: "STATIC_QR", bankName: "ABA" }),
    ]);

    expect(res.status).toBe(200);
    expect(res.body).toEqual({ imported: 2, skipped: 0, productsCreated: 0, errors: [] });

    const order = await prisma.order.findUnique({
      where: { clientOrderUuid: `online-pos:${SOURCE}:1` },
      include: { items: true, terminal: true },
    });
    expect(order).toMatchObject({ totalAmountMinor: 1073, currency: "USD", amountPaidKhrMinor: 44000, paymentMethod: "CASH" });
    expect(order?.items).toEqual([
      expect.objectContaining({ productId: product.id, quantity: 2, priceAtSaleMinor: 22000, currency: "KHR" }),
    ]);
    // Phnom Penh is UTC+7.
    expect(order?.createdAt.toISOString()).toBe("2026-07-06T14:07:44.000Z");
    expect(order?.terminal).toMatchObject({ name: "Legacy import (online-pos)", isActive: false });

    const staticQr = await prisma.order.findUnique({ where: { clientOrderUuid: `online-pos:${SOURCE}:2` } });
    expect(staticQr).toMatchObject({ paymentMethod: "STATIC_QR", bankName: "ABA" });

    const storeProduct = await prisma.storeProduct.findUnique({
      where: { storeId_productId: { storeId: store.id, productId: product.id } },
    });
    expect(storeProduct?.stock).toBe(7);
    expect(await prisma.stockMovement.count()).toBe(0);
  });

  it("skips orders already imported, so re-running a newer backup is safe", async () => {
    const { store } = await seedFixtures();
    const token = await loginAsAdmin();
    await addKhrProduct(store.id, "111", 7);

    await importOrders(store.id, token, [legacyOrder()]);
    const again = await importOrders(store.id, token, [legacyOrder(), legacyOrder({ legacyId: 2 })]);

    expect(again.body).toMatchObject({ imported: 1, skipped: 1 });
    expect(await prisma.order.count()).toBe(2);
    expect(await prisma.terminal.count({ where: { name: "Legacy import (online-pos)" } })).toBe(1);
  });

  it("creates a product that no longer exists as deleted, once", async () => {
    const { store } = await seedFixtures();
    const token = await loginAsAdmin();

    const res = await importOrders(store.id, token, [
      legacyOrder({ items: [{ barcode: "999", name: "Old Item", quantity: 1, priceAtSale: 5000, currency: "KHR" }] }),
      legacyOrder({ legacyId: 2, items: [{ barcode: "999", name: "Old Item", quantity: 3, priceAtSale: 5000, currency: "KHR" }] }),
    ]);

    expect(res.body).toMatchObject({ imported: 2, productsCreated: 1 });
    const created = await prisma.product.findUnique({ where: { barcode: "999" }, include: { storeProducts: true } });
    expect(created).toMatchObject({ name: "Old Item", isDeleted: true });
    expect(created?.storeProducts).toHaveLength(0);
  });

  it("reports a bad order on its own without blocking the rest of the batch", async () => {
    const { store } = await seedFixtures();
    const token = await loginAsAdmin();
    await addKhrProduct(store.id, "111", 7);

    const res = await importOrders(store.id, token, [
      legacyOrder({ legacyId: 1, paymentMethod: "BARTER" }),
      legacyOrder({ legacyId: 2, items: [] }),
      legacyOrder({ legacyId: 3 }),
    ]);

    expect(res.body.imported).toBe(1);
    expect(res.body.errors).toEqual([
      { legacyId: 1, error: 'Unknown payment method "BARTER"' },
      { legacyId: 2, error: expect.stringContaining("items") },
    ]);
  });

  it("imports an order repeated within one batch only once", async () => {
    const { store } = await seedFixtures();
    const token = await loginAsAdmin();
    await addKhrProduct(store.id, "111", 7);

    const res = await importOrders(store.id, token, [legacyOrder(), legacyOrder()]);

    expect(res.body).toMatchObject({ imported: 1, skipped: 1, errors: [] });
    expect(await prisma.order.count()).toBe(1);
  });

  it("keeps deleted and voided orders as such", async () => {
    const { store } = await seedFixtures();
    const token = await loginAsAdmin();
    await addKhrProduct(store.id, "111", 7);

    await importOrders(store.id, token, [legacyOrder({ isDeleted: true }), legacyOrder({ legacyId: 2, status: "VOIDED" })]);

    const [deleted, voided] = await Promise.all([
      prisma.order.findUnique({ where: { clientOrderUuid: `online-pos:${SOURCE}:1` } }),
      prisma.order.findUnique({ where: { clientOrderUuid: `online-pos:${SOURCE}:2` } }),
    ]);
    expect(deleted?.isDeleted).toBe(true);
    expect(voided?.status).toBe("VOIDED");
  });

  it("is admin-only", async () => {
    const { store, terminal } = await seedFixtures();
    await addCashier(store.id, "5678");
    const pinLogin = await request(app)
      .post("/api/auth/pin-login")
      .set("X-Terminal-Id", terminal.id)
      .set("X-Terminal-Secret", "test-terminal-secret")
      .send({ terminalId: terminal.id, storeId: store.id, pin: "5678" });

    const res = await importOrders(store.id, pinLogin.body.sessionToken, [legacyOrder()]);
    expect(res.status).toBe(401);
  });
});

describe("zonedLocalToUtc", () => {
  it("converts shop-local wall-clock time to UTC", () => {
    expect(zonedLocalToUtc("2026-07-06 21:07:44", "Asia/Phnom_Penh").toISOString()).toBe("2026-07-06T14:07:44.000Z");
    expect(zonedLocalToUtc("2026-01-01 00:00", "Asia/Phnom_Penh").toISOString()).toBe("2025-12-31T17:00:00.000Z");
    expect(zonedLocalToUtc("2026-07-06 21:07:44", "UTC").toISOString()).toBe("2026-07-06T21:07:44.000Z");
  });
});
