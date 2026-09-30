import crypto from "node:crypto";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import request from "supertest";
import { buildApp } from "../src/app";
import { prisma } from "../src/prisma";
import { getOnlineOrderByToken, toPublicOrder } from "../src/modules/onlineOrders/onlineOrders.service";
import { addProduct, resetDatabase, seedFixtures } from "./helpers";

const app = buildApp();

beforeEach(async () => {
  await resetDatabase();
});

afterEach(() => {
  vi.unstubAllGlobals();
});

function jsonResponse(body: unknown, init: { status?: number } = {}) {
  return new Response(JSON.stringify(body), {
    status: init.status ?? 200,
    headers: { "Content-Type": "application/json" },
  });
}

async function khqrStore() {
  const { store } = await seedFixtures();
  await prisma.storeSetting.createMany({
    data: [
      { storeId: store.id, key: "bakong_account_id", value: "merchant@bank" },
      { storeId: store.id, key: "bakong_merchant_name", value: "Test Mart" },
      { storeId: store.id, key: "exchange_rate", value: "4000" },
    ],
  });
  // A cached token, so status checks go straight to Bakong without a renewal call.
  await prisma.bakongCredential.create({
    data: { storeId: store.id, registeredEmail: "owner@store.test", apiToken: "valid-token" },
  });
  const { product } = await addProduct(store.id, { name: "Jasmine Rice 5kg", price: 6.5, stock: 10 });
  return { store, product };
}

const placeKhqr = (storeId: string, productId: string) =>
  request(app)
    .post(`/api/public/stores/${storeId}/orders`)
    .send({
      clientOrderUuid: crypto.randomUUID(),
      items: [{ productId, quantity: 2 }],
      customerName: "Dara",
      customerPhone: "012345678",
      pickupAt: null,
      paymentMethod: "KHQR",
    });

describe("KHQR online orders", () => {
  it("only offers KHQR where both the Bakong account and registered email are set", async () => {
    const { store } = await seedFixtures();
    const get = async () => (await request(app).get(`/api/public/stores/${store.id}`)).body.khqrAvailable;
    expect(await get()).toBe(false);
    await prisma.storeSetting.create({ data: { storeId: store.id, key: "bakong_account_id", value: "merchant@bank" } });
    expect(await get()).toBe(false);
    await prisma.bakongCredential.create({ data: { storeId: store.id, registeredEmail: "owner@store.test" } });
    expect(await get()).toBe(true);
    expect((await request(app).get("/api/public/stores")).body[0].khqrAvailable).toBe(true);
  });

  it("creates the order awaiting payment with a QR code, holding stock", async () => {
    const { store, product } = await khqrStore();
    const before = Date.now();
    const res = await placeKhqr(store.id, product.id);

    expect(res.status).toBe(201);
    expect(res.body.status).toBe("AWAITING_PAYMENT");
    expect(res.body.holdUntil).toBeNull();
    expect(res.body.khqr).toMatchObject({ amount: 13, currency: "USD" });
    expect(res.body.khqr.qrString.length).toBeGreaterThan(50);
    const ttl = new Date(res.body.khqr.expiresAt).getTime() - before;
    expect(ttl).toBeGreaterThan(4.5 * 60_000);
    expect(ttl).toBeLessThanOrEqual(5 * 60_000 + 5_000);

    const tx = await prisma.paymentTransaction.findFirstOrThrow({ where: { onlineOrder: { publicToken: res.body.token } } });
    expect(tx).toMatchObject({ status: "PENDING", orderId: null, currency: "USD", amountMinor: 1300 });
    expect(
      (await prisma.storeProduct.findFirstOrThrow({ where: { storeId: store.id, productId: product.id } })).stock
    ).toBe(8);
  });

  it("encodes the QR in KHR when that's the store's main currency", async () => {
    const { store, product } = await khqrStore();
    await prisma.storeSetting.create({ data: { storeId: store.id, key: "main_currency", value: "KHR" } });
    const res = await placeKhqr(store.id, product.id);
    expect(res.body.khqr).toMatchObject({ amount: 52000, currency: "KHR" }); // $13.00 × 4,000
    expect(res.body.totalAmount).toBe(13);
  });

  it("confirms the order once Bakong reports it paid, checking at most every 3 seconds", async () => {
    const { store, product } = await khqrStore();
    const placed = await placeKhqr(store.id, product.id);
    const token = placed.body.token as string;

    const fetchMock = vi.fn().mockResolvedValue(jsonResponse({ responseCode: 1 }));
    vi.stubGlobal("fetch", fetchMock);

    const t0 = new Date();
    expect((await getOnlineOrderByToken(token, t0)).status).toBe("AWAITING_PAYMENT");
    expect(fetchMock).toHaveBeenCalledTimes(1);
    // A second poll within 3 seconds (another tab, say) doesn't reach Bakong.
    await getOnlineOrderByToken(token, new Date(t0.getTime() + 1_000));
    expect(fetchMock).toHaveBeenCalledTimes(1);

    fetchMock.mockResolvedValue(jsonResponse({ responseCode: 0 }));
    const paidAt = new Date(t0.getTime() + 4_000);
    const paid = await getOnlineOrderByToken(token, paidAt);
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(paid.status).toBe("CONFIRMED");
    expect(paid.paidAt).toEqual(paidAt);
    expect(toPublicOrder(paid).khqr).toBeNull();

    const tx = await prisma.paymentTransaction.findFirstOrThrow({ where: { onlineOrderId: paid.id } });
    expect(tx.status).toBe("PAID");
    // Once confirmed, polling never calls Bakong again.
    await getOnlineOrderByToken(token, new Date(t0.getTime() + 60_000));
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it("treats a Bakong outage as still waiting", async () => {
    const { store, product } = await khqrStore();
    const placed = await placeKhqr(store.id, product.id);
    vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new Error("network down")));

    const res = await request(app).get(`/api/public/orders/${placed.body.token}`);
    expect(res.status).toBe(200);
    expect(res.body.status).toBe("AWAITING_PAYMENT");
    expect(res.body.khqr).not.toBeNull();
  });
});
