import { beforeEach, describe, expect, it } from "vitest";
import request from "supertest";
import { buildApp } from "../src/app";
import { prisma } from "../src/prisma";
import { FIXTURE_PASSWORD, FIXTURE_TERMINAL_SECRET, addCashier, addProduct, resetDatabase, seedFixtures } from "./helpers";

const app = buildApp();

beforeEach(async () => {
  await resetDatabase();
});

async function loginAsAdmin() {
  const res = await request(app).post("/api/auth/login").send({ email: "admin@test.local", password: FIXTURE_PASSWORD });
  return res.body.accessToken as string;
}

async function addSale(storeId: string, terminalId: string, productId: string, uuid: string, createdAt: string, quantity = 2) {
  return prisma.order.create({
    data: {
      storeId,
      terminalId,
      clientOrderUuid: uuid,
      totalAmountMinor: 150 * quantity,
      currency: "USD",
      paymentMethod: "CASH",
      createdAt: new Date(createdAt),
      items: { create: [{ productId, quantity, priceAtSaleMinor: 150, currency: "USD" }] },
    },
  });
}

/** A second store the admin also manages, with its own terminal and product. */
async function addSecondStore(adminId: string) {
  const store = await prisma.store.create({ data: { code: "B2", name: "Branch 2" } });
  await prisma.userStoreRole.create({ data: { userId: adminId, storeId: store.id, role: "ADMIN" } });
  const terminal = await prisma.terminal.create({ data: { storeId: store.id, name: "B2 Register", deviceCredentialHash: "x" } });
  const { product } = await addProduct(store.id, { name: "Juice", price: 1.5, stock: 5 });
  return { store, terminal, product };
}

describe("GET /api/orders", () => {
  it("lists one branch, or every branch the user can see, newest first", async () => {
    const { store, admin, terminal } = await seedFixtures();
    const { product } = await addProduct(store.id, { name: "Widget", price: 1.5, stock: 10 });
    const b2 = await addSecondStore(admin.id);
    const hidden = await prisma.store.create({ data: { code: "NOPE", name: "Not Mine" } });
    const hiddenTerminal = await prisma.terminal.create({ data: { storeId: hidden.id, name: "x", deviceCredentialHash: "x" } });
    await addSale(store.id, terminal.id, product.id, "a-1", "2026-10-01T03:00:00Z");
    await addSale(b2.store.id, b2.terminal.id, b2.product.id, "b-1", "2026-10-02T03:00:00Z");
    await addSale(hidden.id, hiddenTerminal.id, product.id, "hidden-1", "2026-10-03T03:00:00Z");
    await prisma.storeSetting.create({ data: { storeId: b2.store.id, key: "main_currency", value: "KHR" } });
    const token = await loginAsAdmin();

    const all = await request(app).get("/api/orders").set("Authorization", `Bearer ${token}`);
    expect(all.status).toBe(200);
    expect(all.body.map((o: { client_order_uuid: string }) => o.client_order_uuid)).toEqual(["b-1", "a-1"]);
    expect(all.body[0]).toMatchObject({ store_name: "Branch 2", terminal_name: "B2 Register", total_amount: 3, exchange_rate: 4100, main_currency: "KHR" });
    expect(all.body[1]).toMatchObject({ main_currency: "USD" }); // no setting: USD
    expect(all.body[0].items).toEqual([expect.objectContaining({ product_name: "Juice", quantity: 2, price: 1.5 })]);

    const one = await request(app).get("/api/orders").query({ storeId: store.id }).set("Authorization", `Bearer ${token}`);
    expect(one.body.map((o: { client_order_uuid: string }) => o.client_order_uuid)).toEqual(["a-1"]);

    const forbidden = await request(app).get("/api/orders").query({ storeId: hidden.id }).set("Authorization", `Bearer ${token}`);
    expect(forbidden.status).toBe(403);
  });

  it("filters by date range and includes voided sales with their status", async () => {
    const { store, terminal } = await seedFixtures();
    const { product } = await addProduct(store.id, { name: "Widget", price: 1.5, stock: 10 });
    await addSale(store.id, terminal.id, product.id, "before", "2026-10-01T16:59:59Z");
    const voided = await addSale(store.id, terminal.id, product.id, "voided", "2026-10-01T18:00:00Z");
    await prisma.order.update({ where: { id: voided.id }, data: { status: "VOIDED" } });
    const token = await loginAsAdmin();

    const res = await request(app)
      .get("/api/orders")
      .query({ date_from: "2026-10-01T17:00:00.000Z", date_to: "2026-10-02T17:00:00.000Z" })
      .set("Authorization", `Bearer ${token}`);

    expect(res.body).toEqual([expect.objectContaining({ client_order_uuid: "voided", status: "VOIDED" })]);
  });
});

describe("POST /api/stores/:storeId/orders/:orderId/void", () => {
  it("voids a sale and puts its items back in stock, once", async () => {
    const { store, terminal } = await seedFixtures();
    const { product } = await addProduct(store.id, { name: "Widget", price: 1.5, stock: 10 });
    const sale = await addSale(store.id, terminal.id, product.id, "sale-1", "2026-10-01T03:00:00Z", 3);
    const token = await loginAsAdmin();

    const res = await request(app).post(`/api/stores/${store.id}/orders/${sale.id}/void`).set("Authorization", `Bearer ${token}`);
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ id: sale.id, status: "VOIDED" });

    const stock = await prisma.storeProduct.findUnique({ where: { storeId_productId: { storeId: store.id, productId: product.id } } });
    expect(stock?.stock).toBe(13);
    expect(await prisma.stockMovement.findMany({ where: { productId: product.id } })).toEqual([
      expect.objectContaining({ delta: 3, reason: "VOID", refType: "IMS_VOID", refId: sale.id }),
    ]);

    const again = await request(app).post(`/api/stores/${store.id}/orders/${sale.id}/void`).set("Authorization", `Bearer ${token}`);
    expect(again.status).toBe(400);
  });

  it("makes a register's later void of the same sale a no-op", async () => {
    const { store, terminal } = await seedFixtures();
    const { product } = await addProduct(store.id, { name: "Widget", price: 1.5, stock: 10 });
    const sale = await addSale(store.id, terminal.id, product.id, "sale-1", "2026-10-01T03:00:00Z", 3);
    const token = await loginAsAdmin();
    await request(app).post(`/api/stores/${store.id}/orders/${sale.id}/void`).set("Authorization", `Bearer ${token}`);

    const push = await request(app)
      .post("/api/sync/push")
      .set({ "X-Terminal-Id": terminal.id, "X-Terminal-Secret": FIXTURE_TERMINAL_SECRET })
      .send({
        events: [
          {
            eventId: crypto.randomUUID(),
            terminalId: terminal.id,
            sequenceNo: 1,
            eventType: "SALE_VOIDED",
            createdAt: new Date().toISOString(),
            payload: { clientOrderUuid: "sale-1" },
          },
        ],
      });

    expect(push.body.results[0].status).toBe("applied");
    const stock = await prisma.storeProduct.findUnique({ where: { storeId_productId: { storeId: store.id, productId: product.id } } });
    expect(stock?.stock).toBe(13); // restocked once, not twice
  });

  it("is admin-only and scoped to the store in the URL", async () => {
    const { store, terminal } = await seedFixtures();
    const { product } = await addProduct(store.id, { name: "Widget", price: 1.5, stock: 10 });
    const sale = await addSale(store.id, terminal.id, product.id, "sale-1", "2026-10-01T03:00:00Z");
    await addCashier(store.id, "5678");
    const pinLogin = await request(app)
      .post("/api/auth/pin-login")
      .set({ "X-Terminal-Id": terminal.id, "X-Terminal-Secret": FIXTURE_TERMINAL_SECRET })
      .send({ terminalId: terminal.id, storeId: store.id, pin: "5678" });

    const asCashier = await request(app)
      .post(`/api/stores/${store.id}/orders/${sale.id}/void`)
      .set("Authorization", `Bearer ${pinLogin.body.sessionToken}`);
    expect(asCashier.status).toBe(401);

    const other = await prisma.store.create({ data: { code: "OTHER", name: "Other" } });
    const token = await loginAsAdmin();
    const wrongStore = await request(app).post(`/api/stores/${other.id}/orders/${sale.id}/void`).set("Authorization", `Bearer ${token}`);
    expect(wrongStore.status).toBeGreaterThanOrEqual(400);
    const order = await prisma.order.findUnique({ where: { id: sale.id } });
    expect(order?.status).toBe("COMPLETED");
  });
});
