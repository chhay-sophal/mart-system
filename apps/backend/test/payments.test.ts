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
    .send({ username: "admin", password: FIXTURE_PASSWORD });
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

  it("uses the register's own merchant details when it sends them, over the store's", async () => {
    const { store, terminal } = await seedFixtures();
    await prisma.storeSetting.create({ data: { storeId: store.id, key: "bakong_account_id", value: "store@bank" } });

    const res = await request(app)
      .post("/api/payments/khqr")
      .set(terminalHeaders(terminal.id))
      .send({ amount: 5000, currency: "KHR", bakongAccountId: "branch2@aclb", merchantName: "SOSO Branch 2", merchantCity: "Siem Reap" });

    expect(res.status).toBe(200);
    expect(res.body.qrString).toContain("branch2@aclb");
    expect(res.body.qrString).toContain("SOSO Branch 2");
    expect(res.body.qrString).toContain("Siem Reap");
    expect(res.body.qrString).not.toContain("store@bank");
  });

  it("rejects a request without valid terminal credentials", async () => {
    const res = await request(app).post("/api/payments/khqr").send({ amount: 1, currency: "USD" });
    expect(res.status).toBe(401);
  });
});

// Issues a real KHQR through the API, as a register would, so status checks
// have a recorded QR to answer for.
async function issueKhqr(terminalId: string, amount = 2.5, currency: "USD" | "KHR" = "USD") {
  const res = await request(app)
    .post("/api/payments/khqr")
    .set(terminalHeaders(terminalId))
    .send({ amount, currency, bakongAccountId: "merchant@bank" });
  expect(res.status).toBe(200);
  return res.body as { md5Hash: string; qrString: string; expiresAt: string };
}

const BAKONG_STATUS_URL = "check_transaction_by_md5";
const BAKONG_RENEW_URL = "renew_token";

describe("KHQR issuing", () => {
  it("records each QR it hands out: store, register, amount, account and expiry", async () => {
    const { store, terminal } = await seedFixtures();
    const before = Date.now();
    const { md5Hash, expiresAt } = await issueKhqr(terminal.id, 2.5);

    const issued = await prisma.issuedKhqr.findUnique({ where: { md5Hash } });
    expect(issued).toMatchObject({
      storeId: store.id,
      terminalId: terminal.id,
      accountId: "merchant@bank",
      currency: "USD",
      amountMinor: 250,
      status: "PENDING",
    });
    const lifetime = new Date(expiresAt).getTime() - before;
    expect(lifetime).toBeGreaterThan(4.9 * 60 * 1000);
    expect(lifetime).toBeLessThanOrEqual(5 * 60 * 1000 + 1000);
  });
});

describe("GET /api/payments/khqr/:md5Hash/status", () => {
  it("renews the token once on a 401, retries, and remembers the QR as PAID", async () => {
    const { store, terminal } = await seedFixtures();
    await prisma.bakongCredential.create({
      data: { storeId: store.id, registeredEmail: "owner@store.test", apiToken: "stale-token" },
    });
    const { md5Hash } = await issueKhqr(terminal.id);

    const fetchMock = vi
      .fn()
      // First check-status call with the stale token -> Bakong says unauthorized.
      .mockResolvedValueOnce(jsonResponse({}, { status: 401 }))
      // Token renewal succeeds.
      .mockResolvedValueOnce(jsonResponse({ data: { token: "fresh-token" } }))
      // Retried check-status call with the fresh token succeeds.
      .mockResolvedValueOnce(jsonResponse({ responseCode: 0, data: { amount: 2.5, currency: "USD", toAccountId: "merchant@bank" } }));
    vi.stubGlobal("fetch", fetchMock);

    const res = await request(app).get(`/api/payments/khqr/${md5Hash}/status`).set(terminalHeaders(terminal.id));

    expect(res.status).toBe(200);
    expect(res.body.status).toBe("PAID");
    expect(fetchMock).toHaveBeenCalledTimes(3);
    const credential = await prisma.bakongCredential.findUnique({ where: { storeId: store.id } });
    expect(credential?.apiToken).toBe("fresh-token");
    expect((await prisma.issuedKhqr.findUnique({ where: { md5Hash } }))?.status).toBe("PAID");

    // Once PAID it stays PAID without asking Bakong again.
    const again = await request(app).get(`/api/payments/khqr/${md5Hash}/status`).set(terminalHeaders(terminal.id));
    expect(again.body.status).toBe("PAID");
    expect(fetchMock).toHaveBeenCalledTimes(3);
  });

  it("returns PENDING when Bakong hasn't seen the payment yet", async () => {
    const { store, terminal } = await seedFixtures();
    await prisma.bakongCredential.create({
      data: { storeId: store.id, registeredEmail: "owner@store.test", apiToken: "valid-token" },
    });
    const { md5Hash } = await issueKhqr(terminal.id);
    vi.stubGlobal("fetch", vi.fn().mockResolvedValueOnce(jsonResponse({ responseCode: 1 })));

    const res = await request(app).get(`/api/payments/khqr/${md5Hash}/status`).set(terminalHeaders(terminal.id));

    expect(res.status).toBe(200);
    expect(res.body.status).toBe("PENDING");
  });

  it("refuses to confirm a payment that doesn't match the QR as issued", async () => {
    const { store, terminal } = await seedFixtures();
    await prisma.bakongCredential.create({
      data: { storeId: store.id, registeredEmail: "owner@store.test", apiToken: "valid-token" },
    });
    const { md5Hash } = await issueKhqr(terminal.id, 2.5);

    for (const [data, label] of [
      [{ amount: 0.5, currency: "USD", toAccountId: "merchant@bank" }, "amount"],
      [{ amount: 2.5, currency: "KHR", toAccountId: "merchant@bank" }, "currency"],
      [{ amount: 2.5, currency: "USD", toAccountId: "someone-else@bank" }, "account"],
    ] as const) {
      vi.stubGlobal("fetch", vi.fn().mockResolvedValueOnce(jsonResponse({ responseCode: 0, data })));
      const res = await request(app).get(`/api/payments/khqr/${md5Hash}/status`).set(terminalHeaders(terminal.id));
      expect(res.status, label).toBe(409);
    }
    expect((await prisma.issuedKhqr.findUnique({ where: { md5Hash } }))?.status).toBe("PENDING");
  });

  it("reports EXPIRED once an unpaid QR is past its expiry (plus grace)", async () => {
    const { store, terminal } = await seedFixtures();
    await prisma.bakongCredential.create({
      data: { storeId: store.id, registeredEmail: "owner@store.test", apiToken: "valid-token" },
    });
    const { md5Hash } = await issueKhqr(terminal.id);
    await prisma.issuedKhqr.update({ where: { md5Hash }, data: { expiresAt: new Date(Date.now() - 3 * 60 * 1000) } });
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(jsonResponse({ responseCode: 1 })));

    const res = await request(app).get(`/api/payments/khqr/${md5Hash}/status`).set(terminalHeaders(terminal.id));

    expect(res.body.status).toBe("EXPIRED");
    expect((await prisma.issuedKhqr.findUnique({ where: { md5Hash } }))?.status).toBe("EXPIRED");
  });

  it("answers only for QRs this store issued", async () => {
    const { terminal } = await seedFixtures();
    const unknown = await request(app).get("/api/payments/khqr/never-issued/status").set(terminalHeaders(terminal.id));
    expect(unknown.status).toBe(404);

    const { md5Hash } = await issueKhqr(terminal.id);
    const otherStore = await prisma.store.create({ data: { code: "OTHER", name: "Other Store" } });
    await prisma.issuedKhqr.update({ where: { md5Hash }, data: { storeId: otherStore.id } });
    const foreign = await request(app).get(`/api/payments/khqr/${md5Hash}/status`).set(terminalHeaders(terminal.id));
    expect(foreign.status).toBe(404);
  });

  it("renews an expired token only once when several checks hit it at the same time", async () => {
    const { store, terminal } = await seedFixtures();
    await prisma.bakongCredential.create({
      data: { storeId: store.id, registeredEmail: "owner@store.test", apiToken: "stale-token" },
    });
    const first = await issueKhqr(terminal.id, 1);
    const second = await issueKhqr(terminal.id, 2);

    let renewals = 0;
    vi.stubGlobal(
      "fetch",
      vi.fn(async (url: string, init: RequestInit) => {
        if (url.includes(BAKONG_RENEW_URL)) {
          renewals++;
          await new Promise((r) => setTimeout(r, 20));
          return jsonResponse({ data: { token: "fresh-token" } });
        }
        expect(url).toContain(BAKONG_STATUS_URL);
        const auth = (init.headers as Record<string, string>).Authorization;
        return auth === "Bearer stale-token" ? jsonResponse({}, { status: 401 }) : jsonResponse({ responseCode: 1 });
      })
    );

    const results = await Promise.all(
      [first, second].map(({ md5Hash }) =>
        request(app).get(`/api/payments/khqr/${md5Hash}/status`).set(terminalHeaders(terminal.id))
      )
    );

    expect(results.map((r) => r.body.status)).toEqual(["PENDING", "PENDING"]);
    expect(renewals).toBe(1);
  });

  it("returns a clear 400 when the store has no registered email configured yet", async () => {
    const { terminal } = await seedFixtures();
    // No BakongCredential row at all — never configured.
    const { md5Hash } = await issueKhqr(terminal.id);
    const res = await request(app).get(`/api/payments/khqr/${md5Hash}/status`).set(terminalHeaders(terminal.id));
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
