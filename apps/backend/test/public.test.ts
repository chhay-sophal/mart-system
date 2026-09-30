import { beforeEach, describe, expect, it } from "vitest";
import express from "express";
import request from "supertest";
import { buildApp } from "../src/app";
import { prisma } from "../src/prisma";
import { toMinorUnits } from "../src/lib/money";
import { createRequestRateLimiter } from "../src/middleware/rateLimiter";
import { errorHandler } from "../src/middleware/errorHandler";
import { addProduct, resetDatabase, seedFixtures } from "./helpers";

const app = buildApp();

beforeEach(async () => {
  await resetDatabase();
});

describe("public stores", () => {
  it("lists only active stores, without a login, and exposes only public fields", async () => {
    await seedFixtures();
    await prisma.store.create({ data: { code: "CLOSED", name: "Closed Branch", isActive: false } });

    const res = await request(app).get("/api/public/stores");
    expect(res.status).toBe(200);
    expect(res.body).toHaveLength(1);
    expect(Object.keys(res.body[0]).sort()).toEqual([
      "address",
      "code",
      "id",
      "khqrAvailable",
      "latitude",
      "longitude",
      "name",
      "openingHours",
      "phone",
      "timezone",
    ]);
    expect(res.body[0].name).toBe("Test Store");
  });

  it("404s an inactive or unknown store", async () => {
    const closed = await prisma.store.create({ data: { code: "CLOSED", name: "Closed Branch", isActive: false } });

    expect((await request(app).get(`/api/public/stores/${closed.id}`)).status).toBe(404);
    expect((await request(app).get(`/api/public/stores/${closed.id}/products`)).status).toBe(404);
    expect((await request(app).get("/api/public/stores/nope")).status).toBe(404);
  });
});

describe("public catalog", () => {
  it("returns effective price and a stock level, never cost price or a raw count", async () => {
    const { store } = await seedFixtures();
    const { product: rice } = await addProduct(store.id, { name: "Jasmine Rice 5kg", price: 6.5, stock: 25 });
    const { product: milk, storeProduct: milkRow } = await addProduct(store.id, { name: "Fresh Milk 1L", price: 1.7, stock: 3 });
    await addProduct(store.id, { name: "Ice Cream Cup", price: 0.8, stock: 0 });
    await prisma.storeProduct.update({
      where: { id: milkRow.id },
      data: { priceOverrideMinor: toMinorUnits(1.5, "USD"), costPriceMinor: toMinorUnits(1.2, "USD") },
    });

    const res = await request(app).get(`/api/public/stores/${store.id}/products`);
    expect(res.status).toBe(200);
    expect(res.body.map((p: { name: string }) => p.name)).toEqual(["Fresh Milk 1L", "Ice Cream Cup", "Jasmine Rice 5kg"]);

    const byId = Object.fromEntries(res.body.map((p: { id: string }) => [p.id, p]));
    expect(byId[rice.id]).toMatchObject({ price: 6.5, currency: "USD", stockLevel: "IN_STOCK" });
    // Default lowStockThreshold is 5, so 3 left is LOW; the branch override wins over the catalog price.
    expect(byId[milk.id]).toMatchObject({ price: 1.5, stockLevel: "LOW_STOCK" });
    expect(res.body.find((p: { name: string }) => p.name === "Ice Cream Cup").stockLevel).toBe("OUT_OF_STOCK");

    for (const p of res.body) {
      expect(Object.keys(p).sort()).toEqual(["category", "currency", "id", "name", "price", "stockLevel"]);
    }
  });

  it("filters by category and hides deleted products", async () => {
    const { store } = await seedFixtures();
    const { product: rice } = await addProduct(store.id, { name: "Jasmine Rice 5kg", price: 6.5, stock: 25 });
    const { product: water } = await addProduct(store.id, { name: "Bottled Water 500ml", price: 0.25, stock: 200 });
    const { product: gone } = await addProduct(store.id, { name: "Discontinued Soda", price: 0.5, stock: 10 });
    await prisma.product.update({ where: { id: rice.id }, data: { category: "Pantry" } });
    await prisma.product.update({ where: { id: water.id }, data: { category: "Drinks" } });
    await prisma.product.update({ where: { id: gone.id }, data: { category: "Drinks", isDeleted: true } });

    const drinks = await request(app).get(`/api/public/stores/${store.id}/products?category=Drinks`);
    expect(drinks.status).toBe(200);
    expect(drinks.body.map((p: { id: string }) => p.id)).toEqual([water.id]);

    const single = await request(app).get(`/api/public/stores/${store.id}/products/${rice.id}`);
    expect(single.status).toBe(200);
    expect(single.body).toMatchObject({ name: "Jasmine Rice 5kg", category: "Pantry" });

    expect((await request(app).get(`/api/public/stores/${store.id}/products/${gone.id}`)).status).toBe(404);
  });

  it("reports availability at each active branch carrying the product", async () => {
    const { store } = await seedFixtures();
    const { product } = await addProduct(store.id, { name: "Jasmine Rice 5kg", price: 6.5, stock: 25 });
    const second = await prisma.store.create({ data: { code: "B2", name: "Branch Two" } });
    const closed = await prisma.store.create({ data: { code: "B3", name: "Closed Branch", isActive: false } });
    await prisma.storeProduct.create({ data: { storeId: second.id, productId: product.id, stock: 0 } });
    await prisma.storeProduct.create({ data: { storeId: closed.id, productId: product.id, stock: 50 } });

    const res = await request(app).get(`/api/public/products/${product.id}/availability`);
    expect(res.status).toBe(200);
    expect(res.body).toEqual([
      { storeId: second.id, storeName: "Branch Two", stockLevel: "OUT_OF_STOCK" },
      { storeId: store.id, storeName: "Test Store", stockLevel: "IN_STOCK" },
    ]);

    expect((await request(app).get("/api/public/products/nope/availability")).status).toBe(404);
  });
});

describe("request rate limiter", () => {
  it("rejects requests past the per-IP cap with 429 and Retry-After", async () => {
    const mini = express();
    mini.use(createRequestRateLimiter({ max: 2, windowMs: 60_000 }));
    mini.get("/", (_req, res) => res.json({ ok: true }));
    mini.use(errorHandler);

    expect((await request(mini).get("/")).status).toBe(200);
    expect((await request(mini).get("/")).status).toBe(200);
    const limited = await request(mini).get("/");
    expect(limited.status).toBe(429);
    expect(Number(limited.headers["retry-after"])).toBeGreaterThan(0);
  });
});
