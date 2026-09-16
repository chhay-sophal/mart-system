import { beforeEach, describe, expect, it } from "vitest";
import request from "supertest";
import { buildApp } from "../src/app";
import { prisma } from "../src/prisma";
import { hashPassword } from "../src/lib/hash";
import {
  FIXTURE_PASSWORD,
  FIXTURE_PIN,
  FIXTURE_TERMINAL_SECRET,
  addCashier,
  resetDatabase,
  seedFixtures,
  seedOtherOrgStore,
  seedSiblingStore,
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

  it("only lists products belonging to the requested store", async () => {
    const { store } = await seedFixtures();
    const token = await loginAsAdmin();

    // A second store in a completely different organization — created directly
    // via Prisma since Phase 1 has no HTTP "create store" endpoint (stores are pre-provisioned).
    const { store: otherStore } = await seedOtherOrgStore();
    const otherProduct = await prisma.product.create({
      data: { organizationId: otherStore.organizationId, name: "Other Store Item", defaultPrice: 1, currency: "USD" },
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

  it("shares one catalog entry across sibling stores in the same organization", async () => {
    const { store, organization, admin } = await seedFixtures();
    const token = await loginAsAdmin();
    const siblingStore = await seedSiblingStore(organization.id);
    await prisma.userStoreRole.create({ data: { userId: admin.id, storeId: siblingStore.id, role: "ADMIN" } });

    await request(app)
      .post(`/api/stores/${store.id}/products/bulk-import`)
      .set("Authorization", `Bearer ${token}`)
      .send({ products: [{ name: "Chips", barcode: "SHARED-1", price: "1.00", stock: "5" }] });

    const res = await request(app)
      .post(`/api/stores/${siblingStore.id}/products/bulk-import`)
      .set("Authorization", `Bearer ${token}`)
      .send({
        products: [{ name: "Chips (Renamed)", barcode: "SHARED-1", price: "1.50", stock: "3" }],
        updateExisting: true,
      });
    expect(res.body).toEqual({ imported: 0, updated: 1, skipped: 0, errors: 0 });

    const productCount = await prisma.product.count({ where: { organizationId: organization.id, barcode: "SHARED-1" } });
    expect(productCount).toBe(1);

    const siblingList = await request(app)
      .get(`/api/stores/${siblingStore.id}/products`)
      .set("Authorization", `Bearer ${token}`);
    expect(siblingList.body[0].name).toBe("Chips (Renamed)");
    expect(siblingList.body[0].stock).toBe(3);
  });

  it("never merges catalogs across two different organizations sharing the same barcode", async () => {
    const { store: storeA } = await seedFixtures();
    const { store: storeB } = await seedOtherOrgStore();
    const tokenA = await loginAsAdmin();

    // storeB's admin: created directly, since the fixture admin (storeA's org) has no role there.
    const adminB = await prisma.user.create({
      data: { email: "adminB@test.local", name: "Admin B", passwordHash: await hashPassword(FIXTURE_PASSWORD) },
    });
    await prisma.userStoreRole.create({ data: { userId: adminB.id, storeId: storeB.id, role: "ADMIN" } });
    const loginB = await request(app)
      .post("/api/auth/login")
      .send({ email: "adminB@test.local", password: FIXTURE_PASSWORD });
    const tokenB = loginB.body.accessToken as string;

    await request(app)
      .post(`/api/stores/${storeA.id}/products/bulk-import`)
      .set("Authorization", `Bearer ${tokenA}`)
      .send({ products: [{ name: "Org A Widget", barcode: "COLLIDE-1", price: "1.00", stock: "5" }] });

    // Import the identical barcode into storeB's (unrelated) org — proves it
    // creates its own row instead of finding/attaching to Org A's product.
    const bImport = await request(app)
      .post(`/api/stores/${storeB.id}/products/bulk-import`)
      .set("Authorization", `Bearer ${tokenB}`)
      .send({ products: [{ name: "Org B Widget", barcode: "COLLIDE-1", price: "9.00", stock: "1" }] });
    expect(bImport.body).toEqual({ imported: 1, updated: 0, skipped: 0, errors: 0 });

    const productsWithBarcode = await prisma.product.findMany({ where: { barcode: "COLLIDE-1" } });
    expect(productsWithBarcode).toHaveLength(2);
    expect(new Set(productsWithBarcode.map((p) => p.organizationId)).size).toBe(2);

    const storeAList = await request(app)
      .get(`/api/stores/${storeA.id}/products`)
      .set("Authorization", `Bearer ${tokenA}`);
    expect(storeAList.body).toHaveLength(1);
    expect(storeAList.body[0].name).toBe("Org A Widget");
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
