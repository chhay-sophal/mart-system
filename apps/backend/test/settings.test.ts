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

describe("store settings", () => {
  it("round-trips a setting through PUT then GET", async () => {
    const { store } = await seedFixtures();
    const token = await loginAsAdmin();

    const put = await request(app)
      .put(`/api/stores/${store.id}/settings`)
      .set("Authorization", `Bearer ${token}`)
      .send({ settings: { exchange_rate: "4100" } });
    expect(put.status).toBe(200);
    expect(put.body.settings.exchange_rate).toBe("4100");

    const get = await request(app)
      .get(`/api/stores/${store.id}/settings`)
      .set("Authorization", `Bearer ${token}`);
    expect(get.status).toBe(200);
    expect(get.body.settings.exchange_rate).toBe("4100");
  });

  it("is admin-only for writes", async () => {
    const { store, terminal } = await seedFixtures();
    await addCashier(store.id, "5678");

    const pinLogin = await request(app)
      .post("/api/auth/pin-login")
      .set("X-Terminal-Id", terminal.id)
      .set("X-Terminal-Secret", "test-terminal-secret")
      .send({ terminalId: terminal.id, storeId: store.id, pin: "5678" });

    const res = await request(app)
      .put(`/api/stores/${store.id}/settings`)
      .set("Authorization", `Bearer ${pinLogin.body.sessionToken}`)
      .send({ settings: { exchange_rate: "9999" } });

    expect(res.status).toBe(401);
  });
});
