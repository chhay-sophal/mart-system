import { beforeEach, describe, expect, it } from "vitest";
import request from "supertest";
import { buildApp } from "../src/app";
import { prisma } from "../src/prisma";
import { FIXTURE_TERMINAL_SECRET, addProduct, resetDatabase, seedFixtures } from "./helpers";

const app = buildApp();

beforeEach(async () => {
  await resetDatabase();
});

function saleEvent(overrides: Partial<Record<string, unknown>> = {}) {
  return {
    eventId: crypto.randomUUID(),
    terminalId: overrides.terminalId ?? "unused",
    sequenceNo: 1,
    eventType: "SALE_COMPLETED" as const,
    createdAt: new Date().toISOString(),
    payload: {
      clientOrderUuid: crypto.randomUUID(),
      items: [{ productId: "unset", quantity: 2, priceAtSale: 1.5, currency: "USD" as const }],
      paymentMethod: "CASH" as const,
      totalAmount: 3,
      amountPaidUsd: 5,
      amountPaidKhr: 0,
      changeGivenKhr: 8200,
    },
    ...overrides,
  };
}

function terminalHeaders(terminalId: string) {
  return { "X-Terminal-Id": terminalId, "X-Terminal-Secret": FIXTURE_TERMINAL_SECRET };
}

describe("POST /api/sync/push", () => {
  it("applies a SALE_COMPLETED event and decrements stock", async () => {
    const { store, terminal } = await seedFixtures();
    const { product } = await addProduct(store.id, { name: "Widget", price: 1.5, stock: 10 });

    const event = saleEvent({ payload: { ...saleEvent().payload, items: [{ productId: product.id, quantity: 2, priceAtSale: 1.5, currency: "USD" }] } });

    const res = await request(app)
      .post("/api/sync/push")
      .set(terminalHeaders(terminal.id))
      .send({ events: [event] });

    expect(res.status).toBe(200);
    expect(res.body.results[0].status).toBe("applied");

    const storeProduct = await prisma.storeProduct.findUnique({
      where: { storeId_productId: { storeId: store.id, productId: product.id } },
    });
    expect(storeProduct?.stock).toBe(8);

    const movements = await prisma.stockMovement.findMany({ where: { productId: product.id } });
    expect(movements).toHaveLength(1);
    expect(movements[0]).toMatchObject({ delta: -2, reason: "SALE" });
  });

  it("treats a replayed eventId as a duplicate and does not double-decrement stock", async () => {
    const { store, terminal } = await seedFixtures();
    const { product } = await addProduct(store.id, { name: "Widget", price: 1.5, stock: 10 });
    const event = saleEvent({ payload: { ...saleEvent().payload, items: [{ productId: product.id, quantity: 2, priceAtSale: 1.5, currency: "USD" }] } });

    const first = await request(app).post("/api/sync/push").set(terminalHeaders(terminal.id)).send({ events: [event] });
    const second = await request(app).post("/api/sync/push").set(terminalHeaders(terminal.id)).send({ events: [event] });

    expect(first.body.results[0].status).toBe("applied");
    expect(second.body.results[0].status).toBe("duplicate");
    expect(second.body.results[0].orderId).toBe(first.body.results[0].orderId);

    const storeProduct = await prisma.storeProduct.findUnique({
      where: { storeId_productId: { storeId: store.id, productId: product.id } },
    });
    expect(storeProduct?.stock).toBe(8);
  });

  it("applies a SALE then its VOID in the same batch and fully reverses stock", async () => {
    const { store, terminal } = await seedFixtures();
    const { product } = await addProduct(store.id, { name: "Widget", price: 1.5, stock: 10 });
    const clientOrderUuid = crypto.randomUUID();
    const sale = saleEvent({
      sequenceNo: 1,
      payload: { ...saleEvent().payload, clientOrderUuid, items: [{ productId: product.id, quantity: 3, priceAtSale: 1.5, currency: "USD" }] },
    });
    const voidEvent = {
      eventId: crypto.randomUUID(),
      terminalId: terminal.id,
      sequenceNo: 2,
      eventType: "SALE_VOIDED" as const,
      createdAt: new Date().toISOString(),
      payload: { clientOrderUuid },
    };

    const res = await request(app)
      .post("/api/sync/push")
      .set(terminalHeaders(terminal.id))
      .send({ events: [sale, voidEvent] });

    expect(res.body.results.map((r: { status: string }) => r.status)).toEqual(["applied", "applied"]);

    const order = await prisma.order.findUnique({ where: { clientOrderUuid } });
    expect(order?.status).toBe("VOIDED");

    const storeProduct = await prisma.storeProduct.findUnique({
      where: { storeId_productId: { storeId: store.id, productId: product.id } },
    });
    expect(storeProduct?.stock).toBe(10);
  });

  it("rejects a request without valid terminal credentials", async () => {
    const { terminal } = await seedFixtures();
    const res = await request(app)
      .post("/api/sync/push")
      .set("X-Terminal-Id", terminal.id)
      .set("X-Terminal-Secret", "wrong-secret")
      .send({ events: [saleEvent()] });
    expect(res.status).toBe(401);
  });

  it("creates a PaymentTransaction when the sale carries KHQR details", async () => {
    const { store, terminal } = await seedFixtures();
    const { product } = await addProduct(store.id, { name: "Widget", price: 1.5, stock: 10 });

    const event = saleEvent({
      payload: {
        ...saleEvent().payload,
        items: [{ productId: product.id, quantity: 1, priceAtSale: 1.5, currency: "USD" }],
        paymentMethod: "KHQR",
        khqrMd5Hash: "abc123md5",
        khqrQrString: "00020101...khqr-string",
      },
    });

    const res = await request(app).post("/api/sync/push").set(terminalHeaders(terminal.id)).send({ events: [event] });
    expect(res.body.results[0].status).toBe("applied");

    const transaction = await prisma.paymentTransaction.findUnique({ where: { md5Hash: "abc123md5" } });
    expect(transaction).toMatchObject({
      orderId: res.body.results[0].orderId,
      qrString: "00020101...khqr-string",
      status: "PAID",
    });
  });
});

describe("GET /api/sync/pull", () => {
  it("returns a full snapshot on first pull, then only rows changed since a given cursor", async () => {
    const { store, terminal } = await seedFixtures();
    const { product } = await addProduct(store.id, { name: "Widget", price: 1.5, stock: 10 });

    const first = await request(app).get("/api/sync/pull").set(terminalHeaders(terminal.id));
    expect(first.status).toBe(200);
    expect(first.body.productUpserts.some((p: { productId: string }) => p.productId === product.id)).toBe(true);
    const cursor = first.body.cursor;

    const unchanged = await request(app).get("/api/sync/pull").query({ since: cursor }).set(terminalHeaders(terminal.id));
    expect(unchanged.body.productUpserts).toHaveLength(0);

    await prisma.storeProduct.update({
      where: { storeId_productId: { storeId: store.id, productId: product.id } },
      data: { stock: 4 },
    });

    const afterChange = await request(app).get("/api/sync/pull").query({ since: cursor }).set(terminalHeaders(terminal.id));
    expect(afterChange.body.productUpserts).toHaveLength(1);
    expect(afterChange.body.productUpserts[0].stock).toBe(4);
  });

  it("rejects a request without valid terminal credentials", async () => {
    const res = await request(app).get("/api/sync/pull");
    expect(res.status).toBe(401);
  });
});
