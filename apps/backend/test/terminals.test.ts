import { beforeEach, describe, expect, it } from "vitest";
import request from "supertest";
import { buildApp } from "../src/app";
import { FIXTURE_PASSWORD, addCashier, resetDatabase, seedFixtures } from "./helpers";

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

describe("terminal pairing", () => {
  it("pairs a new terminal and returns a usable device secret exactly once", async () => {
    const { store } = await seedFixtures();
    await addCashier(store.id, "3344");
    const token = await loginAsAdmin();

    const pair = await request(app)
      .post(`/api/stores/${store.id}/terminals`)
      .set("Authorization", `Bearer ${token}`)
      .send({ name: "Register 2" });

    expect(pair.status).toBe(201);
    expect(pair.body.deviceSecret).toEqual(expect.any(String));
    const terminalId = pair.body.id as string;

    // The secret must actually authenticate a pin-login against this terminal.
    const pinLogin = await request(app)
      .post("/api/auth/pin-login")
      .set("X-Terminal-Id", terminalId)
      .set("X-Terminal-Secret", pair.body.deviceSecret)
      .send({ terminalId, storeId: store.id, pin: "3344" });
    expect(pinLogin.status).toBe(200);

    const list = await request(app)
      .get(`/api/stores/${store.id}/terminals`)
      .set("Authorization", `Bearer ${token}`);
    expect(list.body[0]).not.toHaveProperty("deviceSecret");
  });

  it("rotates the device secret, invalidating the old one", async () => {
    const { store } = await seedFixtures();
    await addCashier(store.id, "3344");
    const token = await loginAsAdmin();

    const pair = await request(app)
      .post(`/api/stores/${store.id}/terminals`)
      .set("Authorization", `Bearer ${token}`)
      .send({ name: "Register 2" });
    const terminalId = pair.body.id as string;
    const oldSecret = pair.body.deviceSecret as string;

    const rotate = await request(app)
      .post(`/api/stores/${store.id}/terminals/${terminalId}/rotate-secret`)
      .set("Authorization", `Bearer ${token}`);
    expect(rotate.status).toBe(200);
    const newSecret = rotate.body.deviceSecret as string;
    expect(newSecret).not.toBe(oldSecret);

    const withOldSecret = await request(app)
      .post("/api/auth/pin-login")
      .set("X-Terminal-Id", terminalId)
      .set("X-Terminal-Secret", oldSecret)
      .send({ terminalId, storeId: store.id, pin: "3344" });
    expect(withOldSecret.status).toBe(401);

    const withNewSecret = await request(app)
      .post("/api/auth/pin-login")
      .set("X-Terminal-Id", terminalId)
      .set("X-Terminal-Secret", newSecret)
      .send({ terminalId, storeId: store.id, pin: "3344" });
    expect(withNewSecret.status).toBe(200);
  });

  it("updates name and can deactivate a terminal", async () => {
    const { store } = await seedFixtures();
    const token = await loginAsAdmin();

    const pair = await request(app)
      .post(`/api/stores/${store.id}/terminals`)
      .set("Authorization", `Bearer ${token}`)
      .send({ name: "Register 2" });
    const terminalId = pair.body.id as string;

    const update = await request(app)
      .patch(`/api/stores/${store.id}/terminals/${terminalId}`)
      .set("Authorization", `Bearer ${token}`)
      .send({ name: "Register 2B", isActive: false });

    expect(update.status).toBe(200);
    expect(update.body).toMatchObject({ name: "Register 2B", isActive: false });
  });

  it("rejects a cashier session token", async () => {
    const { store, terminal } = await seedFixtures();
    await addCashier(store.id, "9999");

    const pinLogin = await request(app)
      .post("/api/auth/pin-login")
      .set("X-Terminal-Id", terminal.id)
      .set("X-Terminal-Secret", "test-terminal-secret")
      .send({ terminalId: terminal.id, storeId: store.id, pin: "9999" });

    const res = await request(app)
      .get(`/api/stores/${store.id}/terminals`)
      .set("Authorization", `Bearer ${pinLogin.body.sessionToken}`);
    expect(res.status).toBe(401);
  });
});
