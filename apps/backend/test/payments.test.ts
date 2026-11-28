import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import request from "supertest";
import { buildApp } from "../src/app";
import { prisma } from "../src/prisma";
import { FIXTURE_PASSWORD, FIXTURE_TERMINAL_SECRET, resetDatabase, seedFixtures } from "./helpers";
import { resetBakongCheckThrottle, reverifyUnconfirmedKhqrPayment } from "../src/modules/payments/payments.service";

const app = buildApp();

beforeEach(async () => {
  await resetDatabase();
  resetBakongCheckThrottle();
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

  it("refuses a payment whose amount or currency doesn't match the QR as issued", async () => {
    const { store, terminal } = await seedFixtures();
    await prisma.bakongCredential.create({
      data: { storeId: store.id, registeredEmail: "owner@store.test", apiToken: "valid-token" },
    });

    for (const [data, label] of [
      [{ amount: 0.5, currency: "USD", toAccountId: "merchant@bank" }, "amount"],
      [{ amount: 2.5, currency: "KHR", toAccountId: "merchant@bank" }, "currency"],
    ] as const) {
      const { md5Hash } = await issueKhqr(terminal.id, 2.5);
      vi.stubGlobal("fetch", vi.fn().mockResolvedValueOnce(jsonResponse({ responseCode: 0, data })));
      const res = await request(app).get(`/api/payments/khqr/${md5Hash}/status`).set(terminalHeaders(terminal.id));
      expect(res.status, label).toBe(409);
      expect((await prisma.issuedKhqr.findUnique({ where: { md5Hash } }))?.status, label).toBe("PENDING");
    }
  });

  it("confirms a payment whose receiving account Bakong formats differently (only logged)", async () => {
    const { store, terminal } = await seedFixtures();
    await prisma.bakongCredential.create({
      data: { storeId: store.id, registeredEmail: "owner@store.test", apiToken: "valid-token" },
    });
    const { md5Hash } = await issueKhqr(terminal.id, 2.5);
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValueOnce(jsonResponse({ responseCode: 0, data: { amount: "2.5", currency: "usd", toAccountId: "000123456" } }))
    );

    const res = await request(app).get(`/api/payments/khqr/${md5Hash}/status`).set(terminalHeaders(terminal.id));

    expect(res.body.status).toBe("PAID");
    expect(warn).toHaveBeenCalledWith(expect.stringContaining("receiving account"));
    warn.mockRestore();
  });

  it("lets a cashier's Check payment ask Bakong again after 3 seconds, automatic checks only after 20", async () => {
    const { store, terminal } = await seedFixtures();
    await prisma.bakongCredential.create({
      data: { storeId: store.id, registeredEmail: "owner@store.test", apiToken: "valid-token" },
    });
    const { md5Hash } = await issueKhqr(terminal.id);
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse({ responseCode: 1, errorCode: 1, responseMessage: "Transaction could not be found." }));
    vi.stubGlobal("fetch", fetchMock);
    const start = Date.now();
    const at = vi.spyOn(Date, "now");
    const check = (offsetMs: number, manual: boolean) => {
      at.mockReturnValue(start + offsetMs);
      return request(app).get(`/api/payments/khqr/${md5Hash}/status${manual ? "?manual=1" : ""}`).set(terminalHeaders(terminal.id));
    };

    await check(0, false); // asks Bakong
    await check(2_000, true); // manual, but under 3s: reused
    await check(4_000, true); // manual, over 3s: asks Bakong
    await check(10_000, false); // automatic, under 20s since the last: reused
    await check(25_000, false); // automatic, over 20s: asks Bakong
    expect(fetchMock).toHaveBeenCalledTimes(3);
    at.mockRestore();
  });

  it("asks Bakong about one QR at most every few seconds, however often registers check", async () => {
    const { store, terminal } = await seedFixtures();
    await prisma.bakongCredential.create({
      data: { storeId: store.id, registeredEmail: "owner@store.test", apiToken: "valid-token" },
    });
    const { md5Hash } = await issueKhqr(terminal.id);
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse({ responseCode: 1, errorCode: 1, responseMessage: "Transaction could not be found." }));
    vi.stubGlobal("fetch", fetchMock);

    for (let i = 0; i < 4; i++) {
      const res = await request(app).get(`/api/payments/khqr/${md5Hash}/status`).set(terminalHeaders(terminal.id));
      expect(res.body.status).toBe("PENDING");
    }
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("reports a Bakong error (e.g. a request limit) instead of reading it as not paid", async () => {
    const { store, terminal } = await seedFixtures();
    await prisma.bakongCredential.create({
      data: { storeId: store.id, registeredEmail: "owner@store.test", apiToken: "valid-token" },
    });
    const { md5Hash } = await issueKhqr(terminal.id);
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const fetchMock = vi
      .fn()
      .mockResolvedValue(jsonResponse({ responseCode: 1, errorCode: 15, responseMessage: "Too many requests" }));
    vi.stubGlobal("fetch", fetchMock);

    const res = await request(app).get(`/api/payments/khqr/${md5Hash}/status`).set(terminalHeaders(terminal.id));
    expect(res.status).toBe(502);
    expect(res.body.error).toBe("Bakong: Too many requests");
    expect(warn).toHaveBeenCalledWith(expect.stringContaining("Too many requests"));

    // Within the throttle window the error is repeated, not hidden as "pending",
    // and Bakong isn't asked again.
    const again = await request(app).get(`/api/payments/khqr/${md5Hash}/status`).set(terminalHeaders(terminal.id));
    expect(again.status).toBe(502);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    warn.mockRestore();
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

// A synced KHQR sale whose payment the backend hasn't confirmed (e.g. a
// cashier confirmed it by hand): an order plus a PENDING PaymentTransaction.
async function unconfirmedKhqrSale(storeId: string, terminalId: string, md5Hash: string, amountMinor = 250) {
  const order = await prisma.order.create({
    data: {
      storeId,
      terminalId,
      clientOrderUuid: `test-${md5Hash}`,
      totalAmountMinor: amountMinor,
      currency: "USD",
      paymentMethod: "KHQR",
      amountPaidUsdMinor: amountMinor,
      createdAt: new Date(),
    },
  });
  return prisma.paymentTransaction.create({
    data: { orderId: order.id, md5Hash, qrString: "qr", currency: "USD", amountMinor, status: "PENDING" },
  });
}

describe("re-checking unconfirmed KHQR payments", () => {
  async function setup() {
    const { store, terminal } = await seedFixtures();
    await prisma.bakongCredential.create({
      data: { storeId: store.id, registeredEmail: "owner@store.test", apiToken: "valid-token" },
    });
    return { store, terminal };
  }

  it("does nothing when every KHQR payment is settled", async () => {
    await setup();
    expect(await reverifyUnconfirmedKhqrPayment()).toBeNull();
  });

  it("marks a hand-confirmed payment PAID once Bakong confirms it", async () => {
    const { store, terminal } = await setup();
    const { md5Hash } = await issueKhqr(terminal.id, 2.5);
    await unconfirmedKhqrSale(store.id, terminal.id, md5Hash);
    vi.stubGlobal("fetch", vi.fn().mockResolvedValueOnce(jsonResponse({ responseCode: 0, data: { amount: 2.5, currency: "USD" } })));

    expect(await reverifyUnconfirmedKhqrPayment()).toEqual({ md5Hash, outcome: "PAID" });
    expect((await prisma.paymentTransaction.findUnique({ where: { md5Hash } }))?.status).toBe("PAID");
    expect((await prisma.issuedKhqr.findUnique({ where: { md5Hash } }))?.status).toBe("PAID");
  });

  it("keeps waiting while Bakong hasn't seen it, then flags it 30 minutes after the QR expired", async () => {
    const { store, terminal } = await setup();
    const { md5Hash } = await issueKhqr(terminal.id);
    await unconfirmedKhqrSale(store.id, terminal.id, md5Hash);
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(jsonResponse({ responseCode: 1, errorCode: 1, responseMessage: "Transaction could not be found." })));

    expect((await reverifyUnconfirmedKhqrPayment())?.outcome).toBe("PENDING");
    expect((await prisma.paymentTransaction.findUnique({ where: { md5Hash } }))?.status).toBe("PENDING");

    await prisma.issuedKhqr.update({ where: { md5Hash }, data: { expiresAt: new Date(Date.now() - 31 * 60 * 1000) } });
    expect((await reverifyUnconfirmedKhqrPayment())?.outcome).toBe("EXPIRED");
    expect((await prisma.paymentTransaction.findUnique({ where: { md5Hash } }))?.status).toBe("EXPIRED");
  });

  it("flags a payment Bakong records differently from the QR", async () => {
    const { store, terminal } = await setup();
    const { md5Hash } = await issueKhqr(terminal.id, 2.5);
    await unconfirmedKhqrSale(store.id, terminal.id, md5Hash);
    vi.stubGlobal("fetch", vi.fn().mockResolvedValueOnce(jsonResponse({ responseCode: 0, data: { amount: 1, currency: "USD" } })));

    expect((await reverifyUnconfirmedKhqrPayment())?.outcome).toBe("EXPIRED");
    expect((await prisma.paymentTransaction.findUnique({ where: { md5Hash } }))?.status).toBe("EXPIRED");
  });

  it("leaves it for a later round on a Bakong error (e.g. the request limit)", async () => {
    const { store, terminal } = await setup();
    const { md5Hash } = await issueKhqr(terminal.id);
    await unconfirmedKhqrSale(store.id, terminal.id, md5Hash);
    vi.stubGlobal("fetch", vi.fn().mockResolvedValueOnce(jsonResponse({ responseCode: 1, errorCode: 15, responseMessage: "Too many requests" })));

    expect((await reverifyUnconfirmedKhqrPayment())?.outcome).toBe("ERROR");
    expect((await prisma.paymentTransaction.findUnique({ where: { md5Hash } }))?.status).toBe("PENDING");
  });

  it("takes turns: one it can't settle yet goes to the back of the queue", async () => {
    const { store, terminal } = await setup();
    const first = await issueKhqr(terminal.id, 1);
    const second = await issueKhqr(terminal.id, 2);
    await unconfirmedKhqrSale(store.id, terminal.id, first.md5Hash, 100);
    await new Promise((r) => setTimeout(r, 5));
    await unconfirmedKhqrSale(store.id, terminal.id, second.md5Hash, 200);
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(jsonResponse({ responseCode: 1, errorCode: 1 })));

    expect((await reverifyUnconfirmedKhqrPayment())?.md5Hash).toBe(first.md5Hash);
    expect((await reverifyUnconfirmedKhqrPayment())?.md5Hash).toBe(second.md5Hash);
  });

  it("a register's status check that finds the QR paid also settles its synced sale", async () => {
    const { store, terminal } = await setup();
    const { md5Hash } = await issueKhqr(terminal.id, 2.5);
    await unconfirmedKhqrSale(store.id, terminal.id, md5Hash);
    vi.stubGlobal("fetch", vi.fn().mockResolvedValueOnce(jsonResponse({ responseCode: 0, data: { amount: 2.5, currency: "USD" } })));

    const res = await request(app).get(`/api/payments/khqr/${md5Hash}/status`).set(terminalHeaders(terminal.id));
    expect(res.body.status).toBe("PAID");
    expect((await prisma.paymentTransaction.findUnique({ where: { md5Hash } }))?.status).toBe("PAID");
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
