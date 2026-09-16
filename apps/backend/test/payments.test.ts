import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import request from "supertest";
import { buildApp } from "../src/app";
import { prisma } from "../src/prisma";
import { FIXTURE_PASSWORD, FIXTURE_TERMINAL_SECRET, resetDatabase, seedFixtures } from "./helpers";

const app = buildApp();

beforeEach(async () => {
  await resetDatabase();
});

afterEach(() => {
  vi.unstubAllGlobals();
});

function terminalHeaders(terminalId: string) {
  return { "X-Terminal-Id": terminalId, "X-Terminal-Secret": FIXTURE_TERMINAL_SECRET };
}

async function loginAsAdmin() {
  const res = await request(app)
    .post("/api/auth/login")
    .send({ email: "admin@test.local", password: FIXTURE_PASSWORD });
  return res.body.accessToken as string;
}

function jsonResponse(body: unknown, init: { status?: number } = {}) {
  return new Response(JSON.stringify(body), { status: init.status ?? 200 });
}

describe("POST /api/payments/khqr", () => {
  it("generates a QR using this store's merchant settings, no network call needed", async () => {
    const { store, terminal } = await seedFixtures();
    await prisma.storeSetting.createMany({
      data: [
        { storeId: store.id, key: "bakong_account_id", value: "merchant@bank" },
        { storeId: store.id, key: "bakong_merchant_name", value: "Test Mart" },
        { storeId: store.id, key: "bakong_merchant_city", value: "Phnom Penh" },
      ],
    });

    const res = await request(app)
      .post("/api/payments/khqr")
      .set(terminalHeaders(terminal.id))
      .send({ amount: 2.5, currency: "USD" });

    expect(res.status).toBe(200);
    expect(res.body.qrString).toEqual(expect.any(String));
    expect(res.body.qrString.length).toBeGreaterThan(0);
    expect(res.body.md5Hash).toEqual(expect.any(String));
    expect(res.body).toMatchObject({ amount: 2.5, currency: "USD" });
  });

  it("rejects a request without valid terminal credentials", async () => {
    const res = await request(app).post("/api/payments/khqr").send({ amount: 1, currency: "USD" });
    expect(res.status).toBe(401);
  });
});

describe("GET /api/payments/khqr/:md5Hash/status", () => {
  it("renews the token once on a 401 and retries", async () => {
    const { store, terminal } = await seedFixtures();
    await prisma.bakongCredential.create({
      data: { storeId: store.id, registeredEmail: "owner@store.test", apiToken: "stale-token" },
    });

    const fetchMock = vi
      .fn()
      // First check-status call with the stale token -> Bakong says unauthorized.
      .mockResolvedValueOnce(jsonResponse({}, { status: 401 }))
      // Token renewal succeeds.
      .mockResolvedValueOnce(jsonResponse({ data: { token: "fresh-token" } }))
      // Retried check-status call with the fresh token succeeds.
      .mockResolvedValueOnce(jsonResponse({ responseCode: 0 }));
    vi.stubGlobal("fetch", fetchMock);

    const res = await request(app)
      .get("/api/payments/khqr/some-md5/status")
      .set(terminalHeaders(terminal.id));

    expect(res.status).toBe(200);
    expect(res.body.status).toBe("PAID");
    expect(fetchMock).toHaveBeenCalledTimes(3);

    const credential = await prisma.bakongCredential.findUnique({ where: { storeId: store.id } });
    expect(credential?.apiToken).toBe("fresh-token");
  });

  it("returns PENDING when Bakong hasn't seen the payment yet", async () => {
    const { store, terminal } = await seedFixtures();
    await prisma.bakongCredential.create({
      data: { storeId: store.id, registeredEmail: "owner@store.test", apiToken: "valid-token" },
    });
    vi.stubGlobal("fetch", vi.fn().mockResolvedValueOnce(jsonResponse({ responseCode: 1 })));

    const res = await request(app)
      .get("/api/payments/khqr/some-md5/status")
      .set(terminalHeaders(terminal.id));

    expect(res.status).toBe(200);
    expect(res.body.status).toBe("PENDING");
  });

  it("returns a clear 400 when the store has no registered email configured yet", async () => {
    const { terminal } = await seedFixtures();
    // No BakongCredential row at all — never configured.
    const res = await request(app)
      .get("/api/payments/khqr/some-md5/status")
      .set(terminalHeaders(terminal.id));
    expect(res.status).toBe(400);
  });

  it("rejects a request without valid terminal credentials", async () => {
    const res = await request(app).get("/api/payments/khqr/some-md5/status");
    expect(res.status).toBe(401);
  });
});

describe("Bakong credential management", () => {
  it("lets an admin set the registered email without ever exposing a cached token", async () => {
    const { store } = await seedFixtures();
    const token = await loginAsAdmin();

    const put = await request(app)
      .put(`/api/stores/${store.id}/bakong-credential`)
      .set("Authorization", `Bearer ${token}`)
      .send({ registeredEmail: "owner@store.test" });
    expect(put.status).toBe(200);
    expect(put.body).toEqual({ registeredEmail: "owner@store.test", hasToken: false });
    expect(put.body).not.toHaveProperty("apiToken");

    const get = await request(app)
      .get(`/api/stores/${store.id}/bakong-credential`)
      .set("Authorization", `Bearer ${token}`);
    expect(get.body).toEqual({ registeredEmail: "owner@store.test", hasToken: false });
  });

  it("rejects a cashier session token entirely", async () => {
    const { store, terminal } = await seedFixtures();
    const pinLogin = await request(app)
      .post("/api/auth/pin-login")
      .set(terminalHeaders(terminal.id))
      .send({ terminalId: terminal.id, storeId: store.id, pin: "1234" });

    const res = await request(app)
      .get(`/api/stores/${store.id}/bakong-credential`)
      .set("Authorization", `Bearer ${pinLogin.body.sessionToken}`);
    expect(res.status).toBe(401);
  });
});
