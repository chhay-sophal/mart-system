import crypto from "node:crypto";
import { beforeEach, describe, expect, it } from "vitest";
import request from "supertest";
import { buildApp } from "../src/app";
import { prisma } from "../src/prisma";
import { FIXTURE_TERMINAL_SECRET, addCashier, addProduct, resetDatabase, seedFixtures } from "./helpers";

const app = buildApp();

beforeEach(async () => {
  await resetDatabase();
});

async function setup() {
  const fx = await seedFixtures();
  const { product } = await addProduct(fx.store.id, { name: "Jasmine Rice 5kg", price: 6.5, stock: 10 });
  const cashier = await addCashier(fx.store.id, "5678");
  return { ...fx, product, cashier };
}

async function place(storeId: string, productId: string) {
  const res = await request(app)
    .post(`/api/public/stores/${storeId}/orders`)
    .send({
      clientOrderUuid: crypto.randomUUID(),
      items: [{ productId, quantity: 2 }],
      customerName: "Dara",
      customerPhone: "012345678",
      pickupAt: null,
      paymentMethod: "PAY_AT_COUNTER",
    });
  expect(res.status).toBe(201);
  return prisma.onlineOrder.findUniqueOrThrow({ where: { publicToken: res.body.token } });
}

const headers = (terminalId: string) => ({ "X-Terminal-Id": terminalId, "X-Terminal-Secret": FIXTURE_TERMINAL_SECRET });

describe("terminal online order endpoints", () => {
  it("lists the terminal's own branch's orders, and only with valid device credentials", async () => {
    const { store, terminal, product } = await setup();
    const order = await place(store.id, product.id);

    const res = await request(app).get("/api/terminal/online-orders").set(headers(terminal.id));
    expect(res.status).toBe(200);
    expect(res.body.map((o: { id: string }) => o.id)).toEqual([order.id]);
    expect(res.body[0].customerPhone).toBe("012345678");

    expect((await request(app).get("/api/terminal/online-orders")).status).toBe(401);
    expect(
      (await request(app).get("/api/terminal/online-orders").set({ ...headers(terminal.id), "X-Terminal-Secret": "wrong" }))
        .status
    ).toBe(401);
  });

  it("lets any active staff member at the branch mark ready and collect", async () => {
    const { store, terminal, product, cashier } = await setup();
    const order = await place(store.id, product.id);
    const base = `/api/terminal/online-orders/${order.id}`;

    const ready = await request(app).post(`${base}/ready`).set(headers(terminal.id)).send({ actorUserId: cashier.id });
    expect(ready.status).toBe(200);
    expect(ready.body.status).toBe("READY");

    const collected = await request(app)
      .post(`${base}/collect`)
      .set(headers(terminal.id))
      .send({ actorUserId: cashier.id, paymentMethod: "CASH" });
    expect(collected.status).toBe(200);
    expect(collected.body).toMatchObject({ status: "COLLECTED", collectedPaymentMethod: "CASH" });
  });

  it("only lets managers cancel", async () => {
    const { store, terminal, product, admin, cashier } = await setup();
    const order = await place(store.id, product.id);
    const url = `/api/terminal/online-orders/${order.id}/cancel`;

    const byCashier = await request(app).post(url).set(headers(terminal.id)).send({ actorUserId: cashier.id });
    expect(byCashier.status).toBe(403);
    expect(byCashier.body.error).toMatch(/inventory staff and admins/);

    const byAdmin = await request(app).post(url).set(headers(terminal.id)).send({ actorUserId: admin.id });
    expect(byAdmin.status).toBe(200);
    expect(byAdmin.body).toMatchObject({ status: "CANCELLED", cancelReason: "STAFF" });
    const stock = await prisma.storeProduct.findFirstOrThrow({ where: { storeId: store.id, productId: product.id } });
    expect(stock.stock).toBe(10);
  });

  it("rejects actors who aren't active staff at this branch, and orders from other branches", async () => {
    const { store, terminal, product, cashier } = await setup();
    const order = await place(store.id, product.id);
    const base = `/api/terminal/online-orders/${order.id}`;

    expect((await request(app).post(`${base}/ready`).set(headers(terminal.id)).send({})).status).toBe(400);
    expect(
      (await request(app).post(`${base}/ready`).set(headers(terminal.id)).send({ actorUserId: "nobody" })).status
    ).toBe(403);

    await prisma.userStoreRole.update({
      where: { userId_storeId: { userId: cashier.id, storeId: store.id } },
      data: { isActive: false },
    });
    expect(
      (await request(app).post(`${base}/ready`).set(headers(terminal.id)).send({ actorUserId: cashier.id })).status
    ).toBe(403);

    // An order at another branch is invisible to this terminal.
    const other = await prisma.store.create({ data: { code: "B2", name: "Branch Two" } });
    const { product: otherProduct } = await addProduct(other.id, { name: "Eggs", price: 1.8, stock: 5 });
    const otherOrder = await place(other.id, otherProduct.id);
    const admin = await prisma.user.findFirstOrThrow({ where: { email: "admin@test.local" } });
    expect(
      (
        await request(app)
          .post(`/api/terminal/online-orders/${otherOrder.id}/ready`)
          .set(headers(terminal.id))
          .send({ actorUserId: admin.id })
      ).status
    ).toBe(404);
  });
});
