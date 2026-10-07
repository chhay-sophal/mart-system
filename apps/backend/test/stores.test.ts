import { beforeEach, describe, expect, it } from "vitest";
import request from "supertest";
import { buildApp } from "../src/app";
import { prisma } from "../src/prisma";
import { hashPassword } from "../src/lib/hash";
import { FIXTURE_PASSWORD, resetDatabase, seedFixtures } from "./helpers";

const app = buildApp();

beforeEach(async () => {
  await resetDatabase();
});

async function login(email: string, password: string) {
  const res = await request(app).post("/api/auth/login").send({ email, password });
  return res.body.accessToken as string;
}

describe("GET /api/stores", () => {
  it("reports the caller's own role at each store", async () => {
    const { store } = await seedFixtures();
    const token = await login("admin@test.local", FIXTURE_PASSWORD);

    const res = await request(app).get("/api/stores").set("Authorization", `Bearer ${token}`);
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject([{ id: store.id, role: "ADMIN" }]);
  });

  it("reports a non-admin role as-is, not ADMIN", async () => {
    const { store } = await seedFixtures();
    const password = "InventoryPassw0rd!";
    const user = await prisma.user.create({
      data: { email: "inventory@test.local", name: "Inventory Staff", passwordHash: await hashPassword(password) },
    });
    await prisma.userStoreRole.create({ data: { userId: user.id, storeId: store.id, role: "INVENTORY" } });

    const token = await login("inventory@test.local", password);
    const res = await request(app).get("/api/stores").set("Authorization", `Bearer ${token}`);
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject([{ id: store.id, role: "INVENTORY" }]);
  });

  it("reports ADMIN for a super admin at every store, even with no UserStoreRole row", async () => {
    const { store } = await seedFixtures();
    const password = "SuperPassw0rd!";
    await prisma.user.create({
      data: { email: "super@test.local", name: "Super Admin", passwordHash: await hashPassword(password), isSuperAdmin: true },
    });

    const token = await login("super@test.local", password);
    const res = await request(app).get("/api/stores").set("Authorization", `Bearer ${token}`);
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject([{ id: store.id, role: "ADMIN" }]);
  });

  it("omits a store the caller has only an inactive role at", async () => {
    const { store } = await seedFixtures();
    const password = "LimitedPassw0rd!";
    const user = await prisma.user.create({
      data: { email: "limited@test.local", name: "Limited", passwordHash: await hashPassword(password) },
    });
    await prisma.userStoreRole.create({ data: { userId: user.id, storeId: store.id, role: "CASHIER", isActive: false } });

    const token = await login("limited@test.local", password);
    const res = await request(app).get("/api/stores").set("Authorization", `Bearer ${token}`);
    expect(res.status).toBe(200);
    expect(res.body).toEqual([]);
  });
});
