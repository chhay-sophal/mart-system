import { prisma } from "../src/prisma";
import { hashDeviceSecret, hashPassword, hashPin } from "../src/lib/hash";

const TABLES = [
  "RefreshToken",
  "UserStoreRole",
  "StockMovement",
  "OrderItem",
  "PaymentTransaction",
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
  await prisma.$executeRawUnsafe(`TRUNCATE TABLE ${TABLES.map((t) => `"${t}"`).join(", ")} RESTART IDENTITY CASCADE;`);
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
