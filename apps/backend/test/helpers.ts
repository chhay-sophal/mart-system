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
  "Organization",
];

export async function resetDatabase() {
  await prisma.$executeRawUnsafe(`TRUNCATE TABLE ${TABLES.map((t) => `"${t}"`).join(", ")} RESTART IDENTITY CASCADE;`);
}

export const FIXTURE_PASSWORD = "TestPassw0rd!";
export const FIXTURE_PIN = "1234";
export const FIXTURE_TERMINAL_SECRET = "test-terminal-secret";

/** Creates one organization + one store + one admin (password+PIN) + one paired terminal, for tests that need a working baseline. */
export async function seedFixtures() {
  const organization = await prisma.organization.create({ data: { name: "Test Org" } });

  const store = await prisma.store.create({
    data: { code: "TEST", name: "Test Store", organizationId: organization.id },
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

  return { organization, store, admin, terminal };
}

/** Creates a second organization + store, for tests proving cross-tenant isolation. */
export async function seedOtherOrgStore() {
  const organization = await prisma.organization.create({ data: { name: "Other Test Org" } });
  const store = await prisma.store.create({
    data: { code: "OTHER", name: "Other Store", organizationId: organization.id },
  });
  return { organization, store };
}

/** Creates a second store within an existing organization, for tests proving same-org sharing/multi-store staff. */
export async function seedSiblingStore(organizationId: string) {
  return prisma.store.create({
    data: { code: "SIBLING", name: "Sibling Store", organizationId },
  });
}

export async function addProduct(storeId: string, opts: { name: string; price: number; stock: number }) {
  const { organizationId } = await prisma.store.findUniqueOrThrow({
    where: { id: storeId },
    select: { organizationId: true },
  });
  const product = await prisma.product.create({
    data: { organizationId, name: opts.name, defaultPrice: opts.price, currency: "USD" },
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
