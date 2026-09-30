import { prisma } from "../src/prisma";
import { hashDeviceSecret, hashPassword, hashPin } from "../src/lib/hash";
import { toMinorUnits } from "../src/lib/money";

const TABLES = [
  "RefreshToken",
  "UserStoreRole",
  "StockMovement",
  "OrderItem",
  "PaymentTransaction",
  "OnlineOrderItem",
  "OnlineOrder",
  "Order",
  "Terminal",
  "StoreProduct",
  "Product",
  "StockTransferItem",
  "StockTransfer",
  "SyncEvent",
  "SyncCursor",
  "StoreSetting",
  "User",
  "Store",
];

export async function resetDatabase() {
  // No TRUNCATE/RESTART IDENTITY on SQLite/libSQL — sequential deletes in the
  // same children-first order that made the CASCADE call FK-safe on Postgres.
  for (const table of TABLES) {
    await prisma.$executeRawUnsafe(`DELETE FROM "${table}";`);
  }
}

export const FIXTURE_PASSWORD = "TestPassw0rd!";
export const FIXTURE_PIN = "1234";
export const FIXTURE_TERMINAL_SECRET = "test-terminal-secret";

/** Creates one store + one admin (password+PIN) + one paired terminal, for tests that need a working baseline. */
export async function seedFixtures() {
  const store = await prisma.store.create({
    data: { code: "TEST", name: "Test Store" },
  });

  const admin = await prisma.user.create({
    data: {
      email: "admin@test.local",
      name: "Test Admin",
      passwordHash: await hashPassword(FIXTURE_PASSWORD),
    },
  });

  await prisma.userStoreRole.create({
    data: {
      userId: admin.id,
      storeId: store.id,
      role: "ADMIN",
      pinHash: await hashPin(FIXTURE_PIN),
    },
  });

  const terminal = await prisma.terminal.create({
    data: {
      storeId: store.id,
      name: "Test Terminal",
      deviceCredentialHash: await hashDeviceSecret(FIXTURE_TERMINAL_SECRET),
    },
  });

  return { store, admin, terminal };
}

export async function addProduct(storeId: string, opts: { name: string; price: number; stock: number }) {
  const product = await prisma.product.create({
    data: { name: opts.name, defaultPriceMinor: toMinorUnits(opts.price, "USD"), currency: "USD" },
  });
  const storeProduct = await prisma.storeProduct.create({
    data: { storeId, productId: product.id, stock: opts.stock, currency: "USD" },
  });
  return { product, storeProduct };
}

export async function addCashier(storeId: string, pin: string) {
  const user = await prisma.user.create({
    data: {
      email: `cashier-${Date.now()}-${Math.random().toString(36).slice(2)}@test.local`,
      name: "Test Cashier",
      passwordHash: await hashPassword("unused-password"),
    },
  });

  await prisma.userStoreRole.create({
    data: { userId: user.id, storeId, role: "CASHIER", pinHash: await hashPin(pin) },
  });

  return user;
}

/** Bakong setup that makes a store offer KHQR, with a cached token so status checks skip the renewal call. */
export async function addKhqrSetup(storeId: string) {
  await prisma.storeSetting.createMany({
    data: [
      { storeId, key: "bakong_account_id", value: "merchant@bank" },
      { storeId, key: "bakong_merchant_name", value: "Test Mart" },
    ],
  });
  await prisma.bakongCredential.create({
    data: { storeId, registeredEmail: "owner@store.test", apiToken: "valid-token" },
  });
}

export function jsonResponse(body: unknown, init: { status?: number } = {}) {
  return new Response(JSON.stringify(body), {
    status: init.status ?? 200,
    headers: { "Content-Type": "application/json" },
  });
}
