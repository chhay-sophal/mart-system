import { beforeEach, describe, expect, it } from "vitest";
import request from "supertest";
import { buildApp } from "../src/app";
import { prisma } from "../src/prisma";
import { receiptNo } from "../src/modules/orders/orders.service";
import { FIXTURE_TERMINAL_SECRET, addProduct, resetDatabase, seedFixtures } from "./helpers";

const app = buildApp();

beforeEach(async () => {
  await resetDatabase();
});

function terminalHeaders(terminalId: string) {
  return { "X-Terminal-Id": terminalId, "X-Terminal-Secret": FIXTURE_TERMINAL_SECRET };
}

async function addOrder(opts: {
  storeId: string;
  terminalId: string;
  productId: string;
  clientOrderUuid: string;
  createdAt: string;
  totalMinor: number;
  currency?: "USD" | "KHR";
  isDeleted?: boolean;
}) {
  return prisma.order.create({
    data: {
      storeId: opts.storeId,
      terminalId: opts.terminalId,
      clientOrderUuid: opts.clientOrderUuid,
      totalAmountMinor: opts.totalMinor,
      currency: opts.currency ?? "USD",
      paymentMethod: "CASH",
      isDeleted: opts.isDeleted ?? false,
      createdAt: new Date(opts.createdAt),
      items: { create: [{ productId: opts.productId, quantity: 2, priceAtSaleMinor: 150, currency: "USD" }] },
    },
  });
}

describe("GET /api/terminal/orders", () => {
  it("lists the whole store's orders, newest first, and nothing from other stores", async () => {
    const { store, terminal } = await seedFixtures();
    const { product } = await addProduct(store.id, { name: "Widget", price: 1.5, stock: 10 });
    const other = await prisma.terminal.create({ data: { storeId: store.id, name: "Register 2", deviceCredentialHash: "x" } });
    const otherStore = await prisma.store.create({ data: { code: "OTHER", name: "Other" } });
    const otherStoreTerminal = await prisma.terminal.create({ data: { storeId: otherStore.id, name: "Elsewhere", deviceCredentialHash: "x" } });

    await addOrder({ storeId: store.id, terminalId: terminal.id, productId: product.id, clientOrderUuid: "aaaaaaaa-1111-2222-3333-444444444444", createdAt: "2026-10-01T03:00:00Z", totalMinor: 300 });
    await addOrder({ storeId: store.id, terminalId: other.id, productId: product.id, clientOrderUuid: "online-pos:abc:7", createdAt: "2026-10-02T03:00:00Z", totalMinor: 41000, currency: "KHR" });
    await addOrder({ storeId: store.id, terminalId: other.id, productId: product.id, clientOrderUuid: "deleted-order", createdAt: "2026-10-02T04:00:00Z", totalMinor: 100, isDeleted: true });
    await addOrder({ storeId: otherStore.id, terminalId: otherStoreTerminal.id, productId: product.id, clientOrderUuid: "elsewhere", createdAt: "2026-10-02T05:00:00Z", totalMinor: 100 });

    const res = await request(app).get("/api/terminal/orders").set(terminalHeaders(terminal.id));

    expect(res.status).toBe(200);
    expect(res.body.map((o: { client_order_uuid: string }) => o.client_order_uuid)).toEqual([
      "online-pos:abc:7",
      "aaaaaaaa-1111-2222-3333-444444444444",
    ]);
    expect(res.body[0]).toMatchObject({
      receipt_no: "OP-0007",
      terminal_name: "Register 2",
      created_at: "2026-10-02T03:00:00.000Z",
      total_amount: 10, // 41000 KHR at the default 4100 rate, in USD
      payment_method: "CASH",
      items: [{ product_name: "Widget", quantity: 2, price: 1.5, currency: "USD" }],
    });
  });

  it("filters by date range", async () => {
    const { store, terminal } = await seedFixtures();
    const { product } = await addProduct(store.id, { name: "Widget", price: 1.5, stock: 10 });
    await addOrder({ storeId: store.id, terminalId: terminal.id, productId: product.id, clientOrderUuid: "before", createdAt: "2026-10-01T16:59:59Z", totalMinor: 100 });
    await addOrder({ storeId: store.id, terminalId: terminal.id, productId: product.id, clientOrderUuid: "inside", createdAt: "2026-10-01T17:00:00Z", totalMinor: 100 });
    await addOrder({ storeId: store.id, terminalId: terminal.id, productId: product.id, clientOrderUuid: "after", createdAt: "2026-10-02T17:00:00Z", totalMinor: 100 });

    const res = await request(app)
      .get("/api/terminal/orders")
      .query({ date_from: "2026-10-01T17:00:00.000Z", date_to: "2026-10-02T17:00:00.000Z" })
      .set(terminalHeaders(terminal.id));

    expect(res.body.map((o: { client_order_uuid: string }) => o.client_order_uuid)).toEqual(["inside"]);
  });

  it("requires terminal credentials", async () => {
    const res = await request(app).get("/api/terminal/orders");
    expect(res.status).toBe(401);
  });
});

describe("GET /api/terminal/daily-summary", () => {
  it("summarises the whole store in the POS's snake_case shape", async () => {
    const { store, terminal } = await seedFixtures();
    const { product } = await addProduct(store.id, { name: "Widget", price: 1.5, stock: 10 });
    const other = await prisma.terminal.create({ data: { storeId: store.id, name: "Register 2", deviceCredentialHash: "x" } });
    await addOrder({ storeId: store.id, terminalId: terminal.id, productId: product.id, clientOrderUuid: "one", createdAt: "2026-10-02T03:00:00Z", totalMinor: 300 });
    await addOrder({ storeId: store.id, terminalId: other.id, productId: product.id, clientOrderUuid: "two", createdAt: "2026-10-02T04:00:00Z", totalMinor: 41000, currency: "KHR" });

    const res = await request(app)
      .get("/api/terminal/daily-summary")
      .query({ date_from: "2026-10-01T17:00:00.000Z", date_to: "2026-10-02T17:00:00.000Z" })
      .set(terminalHeaders(terminal.id));

    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({
      order_count: 2,
      total_revenue: 13,
      avg_order: 6.5,
      by_method: [{ payment_method: "CASH", count: 2, total: 13 }],
      top_products: [{ name: "Widget", total_qty: 4, revenue: 6 }],
    });
    expect(res.body).toHaveProperty("gross_profit");
  });

  it("leaves voided sales out of revenue", async () => {
    const { store, terminal } = await seedFixtures();
    const { product } = await addProduct(store.id, { name: "Widget", price: 1.5, stock: 10 });
    await addOrder({ storeId: store.id, terminalId: terminal.id, productId: product.id, clientOrderUuid: "kept", createdAt: "2026-10-02T03:00:00Z", totalMinor: 300 });
    const voided = await addOrder({ storeId: store.id, terminalId: terminal.id, productId: product.id, clientOrderUuid: "voided", createdAt: "2026-10-02T04:00:00Z", totalMinor: 900 });
    await prisma.order.update({ where: { id: voided.id }, data: { status: "VOIDED" } });

    const res = await request(app)
      .get("/api/terminal/daily-summary")
      .query({ date_from: "2026-10-01T17:00:00.000Z", date_to: "2026-10-02T17:00:00.000Z" })
      .set(terminalHeaders(terminal.id));

    expect(res.body).toMatchObject({ order_count: 1, total_revenue: 3 });
  });

  it("rejects a missing date range", async () => {
    const { terminal } = await seedFixtures();
    const res = await request(app).get("/api/terminal/daily-summary").set(terminalHeaders(terminal.id));
    expect(res.status).toBe(400);
  });
});

describe("receiptNo", () => {
  it("numbers imported orders by their online-pos id and others by UUID prefix", () => {
    expect(receiptNo("online-pos:abc123:42")).toBe("OP-0042");
    expect(receiptNo("3f2a9c1e-0000-0000-0000-000000000000")).toBe("3F2A9C");
  });
});
