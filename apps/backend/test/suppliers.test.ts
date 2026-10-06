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

describe("supplier CRUD", () => {
  it("creates, reads, updates, and soft-deletes a supplier", async () => {
    const { store } = await seedFixtures();
    const token = await loginAsAdmin();

    const create = await request(app)
      .post(`/api/stores/${store.id}/suppliers`)
      .set("Authorization", `Bearer ${token}`)
      .send({ name: "Acme Distribution", phone1: "012345678" });
    expect(create.status).toBe(201);
    expect(create.body).toMatchObject({ name: "Acme Distribution", phone1: "012345678", phone2: null, email: null, address: null, productCount: 0 });
    const supplierId = create.body.id as string;

    const read = await request(app)
      .get(`/api/stores/${store.id}/suppliers/${supplierId}`)
      .set("Authorization", `Bearer ${token}`);
    expect(read.status).toBe(200);
    expect(read.body.name).toBe("Acme Distribution");

    const update = await request(app)
      .put(`/api/stores/${store.id}/suppliers/${supplierId}`)
      .set("Authorization", `Bearer ${token}`)
      .send({ phone2: "098765432", email: "sales@acme.test" });
    expect(update.status).toBe(200);
    expect(update.body).toMatchObject({ phone1: "012345678", phone2: "098765432", email: "sales@acme.test" });

    const del = await request(app)
      .delete(`/api/stores/${store.id}/suppliers/${supplierId}`)
      .set("Authorization", `Bearer ${token}`);
    expect(del.status).toBe(204);

    const readAfterDelete = await request(app)
      .get(`/api/stores/${store.id}/suppliers/${supplierId}`)
      .set("Authorization", `Bearer ${token}`);
    expect(readAfterDelete.status).toBe(404);

    const list = await request(app)
      .get(`/api/stores/${store.id}/suppliers`)
      .set("Authorization", `Bearer ${token}`);
    expect(list.status).toBe(200);
    expect(list.body).toEqual([]);
  });

  it("requires a name and phone1 to create a supplier", async () => {
    const { store } = await seedFixtures();
    const token = await loginAsAdmin();

    const res = await request(app)
      .post(`/api/stores/${store.id}/suppliers`)
      .set("Authorization", `Bearer ${token}`)
      .send({ name: "No Phone Co" });
    expect(res.status).toBe(400);
  });

  it("reports how many non-deleted products point at a supplier", async () => {
    const { store } = await seedFixtures();
    const token = await loginAsAdmin();

    const supplier = await prisma.supplier.create({ data: { name: "Acme", phone1: "012345678" } });
    await addProduct(store.id, { name: "Widget A", price: 1, stock: 1, supplierId: supplier.id });
    const { product: toDelete } = await addProduct(store.id, { name: "Widget B", price: 1, stock: 1, supplierId: supplier.id });
    // A soft-deleted product shouldn't count toward the supplier's total.
    await prisma.product.update({ where: { id: toDelete.id }, data: { isDeleted: true } });

    const res = await request(app)
      .get(`/api/stores/${store.id}/suppliers/${supplier.id}`)
      .set("Authorization", `Bearer ${token}`);
    expect(res.status).toBe(200);
    expect(res.body.productCount).toBe(1);
  });
});

describe("supplier linkage on products", () => {
  it("links a product to a supplier on create and surfaces it on the product view", async () => {
    const { store } = await seedFixtures();
    const token = await loginAsAdmin();

    const supplier = await prisma.supplier.create({ data: { name: "Acme Distribution", phone1: "012345678" } });

    const create = await request(app)
      .post(`/api/stores/${store.id}/products`)
      .set("Authorization", `Bearer ${token}`)
      .send({ name: "Widget", price: 1.5, stock: 10, supplierId: supplier.id });
    expect(create.status).toBe(201);
    expect(create.body).toMatchObject({ supplierId: supplier.id, supplierName: "Acme Distribution" });

    const list = await request(app)
      .get(`/api/stores/${store.id}/products`)
      .set("Authorization", `Bearer ${token}`);
    expect(list.body[0]).toMatchObject({ supplierId: supplier.id, supplierName: "Acme Distribution" });
  });

  it("clears a product's supplier via update, and keeps the link intact if the supplier is later soft-deleted", async () => {
    const { store } = await seedFixtures();
    const token = await loginAsAdmin();

    const supplier = await prisma.supplier.create({ data: { name: "Acme Distribution", phone1: "012345678" } });
    const create = await request(app)
      .post(`/api/stores/${store.id}/products`)
      .set("Authorization", `Bearer ${token}`)
      .send({ name: "Widget", price: 1.5, stock: 10, supplierId: supplier.id });
    const productId = create.body.id as string;

    // Soft-deleting the supplier doesn't sever an existing product's link --
    // it only drops out of listSuppliers (the picker for new assignments).
    await request(app)
      .delete(`/api/stores/${store.id}/suppliers/${supplier.id}`)
      .set("Authorization", `Bearer ${token}`);

    const stillLinked = await request(app)
      .get(`/api/stores/${store.id}/products/${productId}`)
      .set("Authorization", `Bearer ${token}`);
    expect(stillLinked.body).toMatchObject({ supplierId: supplier.id, supplierName: "Acme Distribution" });

    const suppliersList = await request(app)
      .get(`/api/stores/${store.id}/suppliers`)
      .set("Authorization", `Bearer ${token}`);
    expect(suppliersList.body).toEqual([]);

    const cleared = await request(app)
      .put(`/api/stores/${store.id}/products/${productId}`)
      .set("Authorization", `Bearer ${token}`)
      .send({ supplierId: null });
    expect(cleared.status).toBe(200);
    expect(cleared.body.supplierId).toBeNull();
    expect(cleared.body.supplierName).toBeNull();
  });
});
