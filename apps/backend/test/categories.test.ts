import { beforeEach, describe, expect, it } from "vitest";
import request from "supertest";
import { buildApp } from "../src/app";
import { prisma } from "../src/prisma";
import { hashPassword } from "../src/lib/hash";
import { FIXTURE_PASSWORD, addCashier, resetDatabase, seedFixtures } from "./helpers";

const app = buildApp();

beforeEach(async () => {
  await resetDatabase();
});

async function loginAsAdmin() {
  const res = await request(app).post("/api/auth/login").send({ username: "admin", password: FIXTURE_PASSWORD });
  return res.body.accessToken as string;
}

async function createProduct(storeId: string, token: string, body: Record<string, unknown>) {
  return request(app)
    .post(`/api/stores/${storeId}/products`)
    .set("Authorization", `Bearer ${token}`)
    .send({ name: "Cola", price: 1, ...body });
}

describe("category CRUD", () => {
  it("creates, reads, renames, and hard-deletes an unused category", async () => {
    const { store } = await seedFixtures();
    const token = await loginAsAdmin();
    const auth = { Authorization: `Bearer ${token}` };

    const create = await request(app).post(`/api/stores/${store.id}/categories`).set(auth).send({ name: "  Drinks " });
    expect(create.status).toBe(201);
    expect(create.body).toMatchObject({ name: "Drinks", productCount: 0, isDeleted: false });
    const id = create.body.id as string;

    const read = await request(app).get(`/api/stores/${store.id}/categories/${id}`).set(auth);
    expect(read.body.name).toBe("Drinks");

    const rename = await request(app).put(`/api/stores/${store.id}/categories/${id}`).set(auth).send({ name: "Beverages" });
    expect(rename.status).toBe(200);
    expect(rename.body.name).toBe("Beverages");

    const del = await request(app).delete(`/api/stores/${store.id}/categories/${id}`).set(auth);
    expect(del.status).toBe(204);
    expect(await prisma.category.findUnique({ where: { id } })).toBeNull();
  });

  it("rejects a blank name and a duplicate name (including an archived one's)", async () => {
    const { store } = await seedFixtures();
    const token = await loginAsAdmin();
    const auth = { Authorization: `Bearer ${token}` };

    const blank = await request(app).post(`/api/stores/${store.id}/categories`).set(auth).send({ name: "   " });
    expect(blank.status).toBe(400);

    const first = await request(app).post(`/api/stores/${store.id}/categories`).set(auth).send({ name: "Snacks" });
    await createProduct(store.id, token, { categoryId: first.body.id });
    await request(app).delete(`/api/stores/${store.id}/categories/${first.body.id}`).set(auth); // archived: in use

    const dup = await request(app).post(`/api/stores/${store.id}/categories`).set(auth).send({ name: "Snacks" });
    expect(dup.status).toBe(409);

    const other = await request(app).post(`/api/stores/${store.id}/categories`).set(auth).send({ name: "Toys" });
    const renameDup = await request(app).put(`/api/stores/${store.id}/categories/${other.body.id}`).set(auth).send({ name: "Snacks" });
    expect(renameDup.status).toBe(409);
  });

  it("archives a category that products use, hides it unless includeDeleted, and restores it", async () => {
    const { store } = await seedFixtures();
    const token = await loginAsAdmin();
    const auth = { Authorization: `Bearer ${token}` };

    const cat = await request(app).post(`/api/stores/${store.id}/categories`).set(auth).send({ name: "Snacks" });
    const product = await createProduct(store.id, token, { categoryId: cat.body.id });

    const del = await request(app).delete(`/api/stores/${store.id}/categories/${cat.body.id}`).set(auth);
    expect(del.status).toBe(204);
    expect(await prisma.category.findUnique({ where: { id: cat.body.id } })).toMatchObject({ isDeleted: true });

    const list = await request(app).get(`/api/stores/${store.id}/categories`).set(auth);
    expect(list.body).toEqual([]);
    const all = await request(app).get(`/api/stores/${store.id}/categories?includeDeleted=true`).set(auth);
    expect(all.body).toMatchObject([{ id: cat.body.id, isDeleted: true, productCount: 1 }]);

    // The product keeps its (archived) category, by name.
    const read = await request(app).get(`/api/stores/${store.id}/products/${product.body.id}`).set(auth);
    expect(read.body).toMatchObject({ categoryId: cat.body.id, categoryName: "Snacks" });

    const restore = await request(app).post(`/api/stores/${store.id}/categories/${cat.body.id}/restore`).set(auth);
    expect(restore.status).toBe(200);
    expect(restore.body.isDeleted).toBe(false);
  });

  it("lets any role read categories but only INVENTORY/ADMIN manage them", async () => {
    const { store } = await seedFixtures();
    const adminToken = await loginAsAdmin();
    await request(app).post(`/api/stores/${store.id}/categories`).set({ Authorization: `Bearer ${adminToken}` }).send({ name: "Snacks" });

    const cashier = await addCashier(store.id, "4321");
    await prisma.user.update({
      where: { id: cashier.id },
      data: { username: "till", passwordHash: await hashPassword(FIXTURE_PASSWORD) },
    });
    const login = await request(app).post("/api/auth/login").send({ username: "till", password: FIXTURE_PASSWORD });
    const auth = { Authorization: `Bearer ${login.body.accessToken}` };

    const list = await request(app).get(`/api/stores/${store.id}/categories`).set(auth);
    expect(list.status).toBe(200);
    expect(list.body).toHaveLength(1);

    const create = await request(app).post(`/api/stores/${store.id}/categories`).set(auth).send({ name: "Toys" });
    expect(create.status).toBe(403);
  });
});

describe("category linkage on products", () => {
  it("links a product to a category on create, changes it, and clears it", async () => {
    const { store } = await seedFixtures();
    const token = await loginAsAdmin();
    const auth = { Authorization: `Bearer ${token}` };
    const drinks = await request(app).post(`/api/stores/${store.id}/categories`).set(auth).send({ name: "Drinks" });
    const snacks = await request(app).post(`/api/stores/${store.id}/categories`).set(auth).send({ name: "Snacks" });

    const created = await createProduct(store.id, token, { categoryId: drinks.body.id });
    expect(created.status).toBe(201);
    expect(created.body).toMatchObject({ categoryId: drinks.body.id, categoryName: "Drinks" });

    const moved = await request(app).put(`/api/stores/${store.id}/products/${created.body.id}`).set(auth).send({ categoryId: snacks.body.id });
    expect(moved.body).toMatchObject({ categoryId: snacks.body.id, categoryName: "Snacks" });

    const cleared = await request(app).put(`/api/stores/${store.id}/products/${created.body.id}`).set(auth).send({ categoryId: null });
    expect(cleared.body).toMatchObject({ categoryId: null, categoryName: null });

    const counts = await request(app).get(`/api/stores/${store.id}/categories`).set(auth);
    expect(counts.body.map((c: { name: string; productCount: number }) => [c.name, c.productCount])).toEqual([
      ["Drinks", 0],
      ["Snacks", 0],
    ]);
  });
});
