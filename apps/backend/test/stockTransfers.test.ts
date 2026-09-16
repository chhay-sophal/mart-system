import { beforeEach, describe, expect, it } from "vitest";
import request from "supertest";
import { buildApp } from "../src/app";
import { prisma } from "../src/prisma";
import { hashPassword } from "../src/lib/hash";
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

/** A second store + an admin who holds a role at that store only, for cross-store role gating. */
async function seedSecondStore() {
  const store = await prisma.store.create({ data: { code: "BRANCH2", name: "Branch Two" } });
  const admin = await prisma.user.create({
    data: { email: "branch2admin@test.local", name: "Branch Two Admin", passwordHash: await hashPassword(FIXTURE_PASSWORD) },
  });
  await prisma.userStoreRole.create({ data: { userId: admin.id, storeId: store.id, role: "ADMIN" } });
  return { store, admin };
}

describe("inter-store stock transfers", () => {
  it("creates a transfer, then completing it moves stock at both ends including find-or-create at the destination", async () => {
    const { store: fromStore } = await seedFixtures();
    const { store: toStore, admin: toAdmin } = await seedSecondStore();
    const fromToken = await loginAsAdmin();

    const { product } = await addProduct(fromStore.id, { name: "Widget", price: 1, stock: 10 });

    const create = await request(app)
      .post("/api/stock-transfers")
      .set("Authorization", `Bearer ${fromToken}`)
      .send({ fromStoreId: fromStore.id, toStoreId: toStore.id, items: [{ productId: product.id, quantity: 4 }] });
    expect(create.status).toBe(201);
    expect(create.body.status).toBe("REQUESTED");
    expect(create.body.items[0]).toMatchObject({ productId: product.id, productName: "Widget", quantity: 4 });
    const transferId = create.body.id as string;

    // fromStore's admin can't complete it — only the receiving store can confirm receipt
    const wrongComplete = await request(app)
      .post(`/api/stock-transfers/${transferId}/complete`)
      .set("Authorization", `Bearer ${fromToken}`);
    expect(wrongComplete.status).toBe(403);

    const toLogin = await request(app).post("/api/auth/login").send({ email: toAdmin.email, password: FIXTURE_PASSWORD });
    const toToken = toLogin.body.accessToken as string;

    const complete = await request(app)
      .post(`/api/stock-transfers/${transferId}/complete`)
      .set("Authorization", `Bearer ${toToken}`);
    expect(complete.status).toBe(200);
    expect(complete.body.status).toBe("COMPLETED");

    const fromSp = await prisma.storeProduct.findUnique({
      where: { storeId_productId: { storeId: fromStore.id, productId: product.id } },
    });
    expect(fromSp?.stock).toBe(6);

    // destination never carried this product before — find-or-create
    const toSp = await prisma.storeProduct.findUnique({
      where: { storeId_productId: { storeId: toStore.id, productId: product.id } },
    });
    expect(toSp?.stock).toBe(4);

    const movements = await prisma.stockMovement.findMany({ where: { refId: transferId }, orderBy: { storeId: "asc" } });
    expect(movements).toHaveLength(2);
    expect(movements.map((m) => m.reason).sort()).toEqual(["TRANSFER_IN", "TRANSFER_OUT"]);
  });

  it("allows the source store to cancel a still-pending transfer without moving any stock", async () => {
    const { store: fromStore } = await seedFixtures();
    const { store: toStore } = await seedSecondStore();
    const token = await loginAsAdmin();
    const { product } = await addProduct(fromStore.id, { name: "Widget", price: 1, stock: 10 });

    const create = await request(app)
      .post("/api/stock-transfers")
      .set("Authorization", `Bearer ${token}`)
      .send({ fromStoreId: fromStore.id, toStoreId: toStore.id, items: [{ productId: product.id, quantity: 2 }] });

    const cancel = await request(app)
      .post(`/api/stock-transfers/${create.body.id}/cancel`)
      .set("Authorization", `Bearer ${token}`);
    expect(cancel.status).toBe(200);
    expect(cancel.body.status).toBe("CANCELLED");

    const fromSp = await prisma.storeProduct.findUnique({
      where: { storeId_productId: { storeId: fromStore.id, productId: product.id } },
    });
    expect(fromSp?.stock).toBe(10);
  });

  it("rejects creating a transfer for a product not stocked at the source store", async () => {
    const { store: fromStore } = await seedFixtures();
    const { store: toStore } = await seedSecondStore();
    const token = await loginAsAdmin();

    const res = await request(app)
      .post("/api/stock-transfers")
      .set("Authorization", `Bearer ${token}`)
      .send({ fromStoreId: fromStore.id, toStoreId: toStore.id, items: [{ productId: "nonexistent", quantity: 1 }] });

    expect(res.status).toBe(400);
  });

  it("rejects initiating a transfer without a role at the source store", async () => {
    const { store: fromStore } = await seedFixtures();
    const { store: toStore, admin: toAdmin } = await seedSecondStore();
    const { product } = await addProduct(fromStore.id, { name: "Widget", price: 1, stock: 10 });

    const toLogin = await request(app).post("/api/auth/login").send({ email: toAdmin.email, password: FIXTURE_PASSWORD });
    const toToken = toLogin.body.accessToken as string;

    const res = await request(app)
      .post("/api/stock-transfers")
      .set("Authorization", `Bearer ${toToken}`)
      .send({ fromStoreId: fromStore.id, toStoreId: toStore.id, items: [{ productId: product.id, quantity: 1 }] });

    expect(res.status).toBe(403);
  });

  it("lists transfers involving a store the caller can access, from either side", async () => {
    const { store: fromStore } = await seedFixtures();
    const { store: toStore } = await seedSecondStore();
    const token = await loginAsAdmin();
    const { product } = await addProduct(fromStore.id, { name: "Widget", price: 1, stock: 10 });

    await request(app)
      .post("/api/stock-transfers")
      .set("Authorization", `Bearer ${token}`)
      .send({ fromStoreId: fromStore.id, toStoreId: toStore.id, items: [{ productId: product.id, quantity: 1 }] });

    const list = await request(app).get("/api/stock-transfers").set("Authorization", `Bearer ${token}`);
    expect(list.status).toBe(200);
    expect(list.body).toHaveLength(1);
  });
});
