import { beforeEach, describe, expect, it } from "vitest";
import request from "supertest";
import { buildApp } from "../src/app";
import { prisma } from "../src/prisma";
import {
  FIXTURE_PASSWORD,
  FIXTURE_PIN,
  FIXTURE_TERMINAL_SECRET,
  addCashier,
  resetDatabase,
  seedFixtures,
} from "./helpers";

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

describe("product CRUD", () => {
  it("creates, reads, updates, and soft-deletes a product, scoped to its store", async () => {
    const { store } = await seedFixtures();
    const token = await loginAsAdmin();

    const create = await request(app)
      .post(`/api/stores/${store.id}/products`)
      .set("Authorization", `Bearer ${token}`)
      .send({ name: "Test Widget", price: 1.5, stock: 10 });
    expect(create.status).toBe(201);
    const productId = create.body.id as string;

    const read = await request(app)
      .get(`/api/stores/${store.id}/products/${productId}`)
      .set("Authorization", `Bearer ${token}`);
    expect(read.status).toBe(200);
    expect(read.body.name).toBe("Test Widget");
    expect(read.body.stock).toBe(10);

    const update = await request(app)
      .put(`/api/stores/${store.id}/products/${productId}`)
      .set("Authorization", `Bearer ${token}`)
      .send({ stock: 25 });
    expect(update.status).toBe(200);
    expect(update.body.stock).toBe(25);

    const del = await request(app)
      .delete(`/api/stores/${store.id}/products/${productId}`)
      .set("Authorization", `Bearer ${token}`);
    expect(del.status).toBe(204);

    const readAfterDelete = await request(app)
      .get(`/api/stores/${store.id}/products/${productId}`)
      .set("Authorization", `Bearer ${token}`);
    expect(readAfterDelete.status).toBe(404);
  });

  it("sets, reads, and clears a per-store price override independently of the chain default price", async () => {
    const { store } = await seedFixtures();
    const token = await loginAsAdmin();

    const create = await request(app)
      .post(`/api/stores/${store.id}/products`)
      .set("Authorization", `Bearer ${token}`)
      .send({ name: "Overridable Widget", price: 2, priceOverride: 1.5, stock: 5 });
    expect(create.status).toBe(201);
    expect(create.body.defaultPrice).toBe(2);
    expect(create.body.priceOverride).toBe(1.5);
    const productId = create.body.id as string;

    const update = await request(app)
      .put(`/api/stores/${store.id}/products/${productId}`)
      .set("Authorization", `Bearer ${token}`)
      .send({ priceOverride: 1.75 });
    expect(update.body.priceOverride).toBe(1.75);
    expect(update.body.defaultPrice).toBe(2); // untouched by an override-only update

    const cleared = await request(app)
      .put(`/api/stores/${store.id}/products/${productId}`)
      .set("Authorization", `Bearer ${token}`)
      .send({ priceOverride: null });
    expect(cleared.body.priceOverride).toBeNull();
  });

  it("only lists products belonging to the requested store", async () => {
    const { store } = await seedFixtures();
    const token = await loginAsAdmin();

    // A second store the admin also has no reason to see products from — created directly
    // via Prisma since Phase 1 has no HTTP "create store" endpoint (stores are pre-provisioned).
    const otherStore = await prisma.store.create({ data: { code: "OTHER", name: "Other Store" } });
    const otherProduct = await prisma.product.create({
      data: { name: "Other Store Item", defaultPrice: 1, currency: "USD" },
    });
    await prisma.storeProduct.create({
      data: { storeId: otherStore.id, productId: otherProduct.id, stock: 5 },
    });

    await request(app)
      .post(`/api/stores/${store.id}/products`)
      .set("Authorization", `Bearer ${token}`)
      .send({ name: "In Store", price: 1 });

    const list = await request(app)
      .get(`/api/stores/${store.id}/products`)
      .set("Authorization", `Bearer ${token}`);

    expect(list.status).toBe(200);
    expect(list.body.map((p: { name: string }) => p.name)).toEqual(["In Store"]);
  });
});

describe("bulk import", () => {
  it("imports valid rows, skips invalid ones, and defaults unknown currency to USD", async () => {
    const { store } = await seedFixtures();
    const token = await loginAsAdmin();

    const res = await request(app)
      .post(`/api/stores/${store.id}/products/bulk-import`)
      .set("Authorization", `Bearer ${token}`)
      .send({
        products: [
          { name: "Valid Item", price: "2.50", currency: "EUR", stock: "10" },
          { name: "", price: "1.00" }, // missing name -> skipped
          { name: "Bad Price", price: "not-a-number" }, // invalid price -> skipped
        ],
        updateExisting: false,
      });

    expect(res.status).toBe(200);
    expect(res.body).toEqual({ imported: 1, updated: 0, skipped: 2, errors: 0 });

    const list = await request(app)
      .get(`/api/stores/${store.id}/products`)
      .set("Authorization", `Bearer ${token}`);
    const imported = list.body.find((p: { name: string }) => p.name === "Valid Item");
    expect(imported.currency).toBe("USD");
  });

  it("updates an existing product by barcode when updateExisting is true", async () => {
    const { store } = await seedFixtures();
    const token = await loginAsAdmin();

    await request(app)
      .post(`/api/stores/${store.id}/products/bulk-import`)
      .set("Authorization", `Bearer ${token}`)
      .send({ products: [{ name: "Original", barcode: "123", price: "1.00", stock: "5" }] });

    const res = await request(app)
      .post(`/api/stores/${store.id}/products/bulk-import`)
      .set("Authorization", `Bearer ${token}`)
      .send({
        products: [{ name: "Updated", barcode: "123", price: "2.00", stock: "9" }],
        updateExisting: true,
      });

    expect(res.body).toEqual({ imported: 0, updated: 1, skipped: 0, errors: 0 });

    const list = await request(app)
      .get(`/api/stores/${store.id}/products`)
      .set("Authorization", `Bearer ${token}`);
    expect(list.body).toHaveLength(1);
    expect(list.body[0].name).toBe("Updated");
    expect(list.body[0].stock).toBe(9);
  });
});

describe("role gating", () => {
  it("rejects a cashier session on an admin/inventory-only route", async () => {
    const { store, terminal } = await seedFixtures();
    await addCashier(store.id, "5678");

    const pinLogin = await request(app)
      .post("/api/auth/pin-login")
      .set("X-Terminal-Id", terminal.id)
      .set("X-Terminal-Secret", FIXTURE_TERMINAL_SECRET)
      .send({ terminalId: terminal.id, storeId: store.id, pin: "5678" });
    expect(pinLogin.status).toBe(200);

    const res = await request(app)
      .post(`/api/stores/${store.id}/products`)
      .set("Authorization", `Bearer ${pinLogin.body.sessionToken}`)
      .send({ name: "Should Fail", price: 1 });

    expect(res.status).toBe(401); // cashier session tokens aren't accepted by requireAccessToken at all
  });

  it("allows the admin access token through", async () => {
    const { store } = await seedFixtures();
    const token = await loginAsAdmin();

    const res = await request(app)
      .post(`/api/stores/${store.id}/products`)
      .set("Authorization", `Bearer ${token}`)
      .send({ name: "Should Work", price: 1 });

    expect(res.status).toBe(201);
  });
});
