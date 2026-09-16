import { beforeEach, describe, expect, it } from "vitest";
import request from "supertest";
import { buildApp } from "../src/app";
import { prisma } from "../src/prisma";
import { FIXTURE_PASSWORD, addProduct, resetDatabase, seedFixtures } from "./helpers";

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
