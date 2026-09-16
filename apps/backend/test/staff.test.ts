import { beforeEach, describe, expect, it } from "vitest";
import request from "supertest";
import { buildApp } from "../src/app";
import { prisma } from "../src/prisma";
import { FIXTURE_PASSWORD, addCashier, resetDatabase, seedFixtures, seedOtherOrgStore, seedSiblingStore } from "./helpers";

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

describe("staff management", () => {
  it("creates a new staff member with a PIN", async () => {
    const { store } = await seedFixtures();
    const token = await loginAsAdmin();

    const res = await request(app)
      .post(`/api/stores/${store.id}/staff`)
      .set("Authorization", `Bearer ${token}`)
      .send({ email: "cashier1@test.local", name: "Cashier One", password: "Passw0rd!!", role: "CASHIER", pin: "4321" });

    expect(res.status).toBe(201);
    expect(res.body).toMatchObject({ email: "cashier1@test.local", role: "CASHIER", isActive: true, hasPinSet: true });

    const list = await request(app)
      .get(`/api/stores/${store.id}/staff`)
      .set("Authorization", `Bearer ${token}`);
    expect(list.body.map((s: { email: string }) => s.email)).toContain("cashier1@test.local");
  });

  it("attaches a new role to an existing user at a sibling store in the same organization", async () => {
    const { store, organization } = await seedFixtures();
    const token = await loginAsAdmin();

    const siblingStore = await seedSiblingStore(organization.id);

    await request(app)
      .post(`/api/stores/${siblingStore.id}/staff`)
      .set("Authorization", `Bearer ${token}`)
      .send({ email: "multi@test.local", name: "Multi Store", password: "Passw0rd!!", role: "INVENTORY" });

    const res = await request(app)
      .post(`/api/stores/${store.id}/staff`)
      .set("Authorization", `Bearer ${token}`)
      .send({ email: "multi@test.local", name: "Multi Store", password: "Passw0rd!!", role: "ADMIN" });

    expect(res.status).toBe(201);
    expect(res.body.role).toBe("ADMIN");

    const userCount = await prisma.user.count({ where: { email: "multi@test.local" } });
    expect(userCount).toBe(1);
  });

  it("rejects attaching a user who already has a role at a different organization's store", async () => {
    const { store } = await seedFixtures();
    const token = await loginAsAdmin();

    const { store: otherOrgStore } = await seedOtherOrgStore();

    // Set up the pre-existing cross-org role directly — the requesting admin
    // has no access to otherOrgStore, so this can't go through the API under test.
    const crossOrgUser = await prisma.user.create({
      data: { email: "cross-org@test.local", name: "Cross Org", passwordHash: "unused" },
    });
    await prisma.userStoreRole.create({
      data: { userId: crossOrgUser.id, storeId: otherOrgStore.id, role: "INVENTORY" },
    });

    const res = await request(app)
      .post(`/api/stores/${store.id}/staff`)
      .set("Authorization", `Bearer ${token}`)
      .send({ email: "cross-org@test.local", name: "Cross Org", password: "Passw0rd!!", role: "ADMIN" });

    expect(res.status).toBe(409);

    const roleCount = await prisma.userStoreRole.count({
      where: { user: { email: "cross-org@test.local" }, storeId: store.id },
    });
    expect(roleCount).toBe(0);
  });

  it("rejects creating a duplicate role for the same user at the same store", async () => {
    const { store } = await seedFixtures();
    const token = await loginAsAdmin();

    await request(app)
      .post(`/api/stores/${store.id}/staff`)
      .set("Authorization", `Bearer ${token}`)
      .send({ email: "dup@test.local", name: "Dup", password: "Passw0rd!!", role: "CASHIER" });

    const res = await request(app)
      .post(`/api/stores/${store.id}/staff`)
      .set("Authorization", `Bearer ${token}`)
      .send({ email: "dup@test.local", name: "Dup", password: "Passw0rd!!", role: "INVENTORY" });

    expect(res.status).toBe(409);
  });

  it("rejects a PIN that collides with another active staff member's PIN at the same store", async () => {
    const { store } = await seedFixtures();
    const token = await loginAsAdmin();
    await addCashier(store.id, "7777");

    const res = await request(app)
      .post(`/api/stores/${store.id}/staff`)
      .set("Authorization", `Bearer ${token}`)
      .send({ email: "newpin@test.local", name: "New", password: "Passw0rd!!", role: "CASHIER", pin: "7777" });

    expect(res.status).toBe(409);
  });

  it("updates role/isActive and resets a PIN", async () => {
    const { store } = await seedFixtures();
    const token = await loginAsAdmin();
    const cashier = await addCashier(store.id, "5555");

    const update = await request(app)
      .patch(`/api/stores/${store.id}/staff/${cashier.id}`)
      .set("Authorization", `Bearer ${token}`)
      .send({ role: "INVENTORY" });
    expect(update.body.role).toBe("INVENTORY");

    const reset = await request(app)
      .post(`/api/stores/${store.id}/staff/${cashier.id}/reset-pin`)
      .set("Authorization", `Bearer ${token}`)
      .send({ pin: "6060" });
    expect(reset.status).toBe(200);
    expect(reset.body.hasPinSet).toBe(true);
  });

  it("deactivates a staff member without deleting the user", async () => {
    const { store } = await seedFixtures();
    const token = await loginAsAdmin();
    const cashier = await addCashier(store.id, "8888");

    const del = await request(app)
      .delete(`/api/stores/${store.id}/staff/${cashier.id}`)
      .set("Authorization", `Bearer ${token}`);
    expect(del.status).toBe(204);

    const list = await request(app)
      .get(`/api/stores/${store.id}/staff`)
      .set("Authorization", `Bearer ${token}`);
    const found = list.body.find((s: { userId: string }) => s.userId === cashier.id);
    expect(found.isActive).toBe(false);
  });

  it("rejects a cashier session token entirely (staff routes require an IMS access token)", async () => {
    const { store, terminal } = await seedFixtures();
    await addCashier(store.id, "9999");

    const pinLogin = await request(app)
      .post("/api/auth/pin-login")
      .set("X-Terminal-Id", terminal.id)
      .set("X-Terminal-Secret", "test-terminal-secret")
      .send({ terminalId: terminal.id, storeId: store.id, pin: "9999" });

    const res = await request(app)
      .get(`/api/stores/${store.id}/staff`)
      .set("Authorization", `Bearer ${pinLogin.body.sessionToken}`);
    expect(res.status).toBe(401);
  });
});
