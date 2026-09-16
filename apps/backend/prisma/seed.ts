import { PrismaClient } from "@prisma/client";
import { hashDeviceSecret, hashPassword, hashPin } from "../src/lib/hash";
import { toDecimal } from "../src/lib/money";

const prisma = new PrismaClient();

const DEMO_PRODUCTS: Array<{
  name: string;
  barcode: string;
  price: number;
  currency: "USD" | "KHR";
  costPrice: number;
  stock: number;
  lowStockThreshold?: number;
}> = [
  { name: "Coca-Cola 330ml Can", barcode: "8850999327012", price: 0.5, currency: "USD", costPrice: 0.3, stock: 120 },
  { name: "Bottled Water 500ml", barcode: "8850999327029", price: 0.25, currency: "USD", costPrice: 0.12, stock: 200 },
  { name: "Instant Noodles - Chicken", barcode: "8850999327036", price: 0.4, currency: "USD", costPrice: 0.22, stock: 150 },
  { name: "White Bread Loaf", barcode: "8850999327043", price: 1.2, currency: "USD", costPrice: 0.7, stock: 30 },
  { name: "Eggs (Tray of 10)", barcode: "8850999327050", price: 1.8, currency: "USD", costPrice: 1.3, stock: 40 },
  { name: "Jasmine Rice 5kg", barcode: "8850999327067", price: 6.5, currency: "USD", costPrice: 5.2, stock: 25 },
  { name: "Cooking Oil 1L", barcode: "8850999327074", price: 2.1, currency: "USD", costPrice: 1.6, stock: 35 },
  { name: "Fish Sauce 700ml", barcode: "8850999327081", price: 1.5, currency: "USD", costPrice: 1.0, stock: 28 },
  { name: "Instant Coffee 3-in-1 (Box)", barcode: "8850999327098", price: 2.8, currency: "USD", costPrice: 2.0, stock: 45 },
  { name: "Green Tea Bottle 500ml", barcode: "8850999327104", price: 0.6, currency: "USD", costPrice: 0.35, stock: 80 },
  { name: "Potato Chips (Large)", barcode: "8850999327111", price: 1.1, currency: "USD", costPrice: 0.7, stock: 4, lowStockThreshold: 10 },
  { name: "Chocolate Bar", barcode: "8850999327128", price: 0.9, currency: "USD", costPrice: 0.55, stock: 60 },
  { name: "Toilet Paper (4-pack)", barcode: "8850999327135", price: 1.9, currency: "USD", costPrice: 1.3, stock: 22 },
  { name: "Dish Soap 500ml", barcode: "8850999327142", price: 1.3, currency: "USD", costPrice: 0.85, stock: 18 },
  { name: "Laundry Detergent 1kg", barcode: "8850999327159", price: 3.4, currency: "USD", costPrice: 2.5, stock: 15 },
  { name: "Fresh Milk 1L", barcode: "8850999327166", price: 1.7, currency: "USD", costPrice: 1.2, stock: 3, lowStockThreshold: 8 },
  { name: "Yogurt Cup", barcode: "8850999327173", price: 0.55, currency: "USD", costPrice: 0.35, stock: 50 },
  { name: "Ice Cream Cup", barcode: "8850999327180", price: 0.8, currency: "USD", costPrice: 0.5, stock: 24 },
  { name: "Beer Can 330ml", barcode: "8850999327197", price: 0.7, currency: "USD", costPrice: 0.45, stock: 96 },
  { name: "Phone Credit Card $5", barcode: "8850999327203", price: 5.0, currency: "USD", costPrice: 4.8, stock: 200 },
  { name: "Local Snack (KHR-priced)", barcode: "8850999327210", price: 2000, currency: "KHR", costPrice: 1200, stock: 40 },
];

async function main() {
  const store = await prisma.store.upsert({
    where: { code: "MAIN" },
    create: { code: "MAIN", name: "Main Store", timezone: "Asia/Phnom_Penh" },
    update: {},
  });

  const adminEmail = "admin@mart-system.local";
  const adminPassword = "ChangeMe123!";
  const adminPin = "1234";

  const admin = await prisma.user.upsert({
    where: { email: adminEmail },
    create: {
      email: adminEmail,
      name: "Admin",
      isSuperAdmin: true,
      passwordHash: await hashPassword(adminPassword),
    },
    update: {},
  });

  await prisma.userStoreRole.upsert({
    where: { userId_storeId: { userId: admin.id, storeId: store.id } },
    create: {
      userId: admin.id,
      storeId: store.id,
      role: "ADMIN",
      pinHash: await hashPin(adminPin),
    },
    update: { pinHash: await hashPin(adminPin) },
  });

  const existingTerminal = await prisma.terminal.findFirst({ where: { storeId: store.id, name: "Register 1" } });
  const devTerminalSecret = "dev-terminal-secret-do-not-use-in-prod";
  const terminal =
    existingTerminal ??
    (await prisma.terminal.create({
      data: {
        storeId: store.id,
        name: "Register 1",
        deviceCredentialHash: await hashDeviceSecret(devTerminalSecret),
      },
    }));

  for (const item of DEMO_PRODUCTS) {
    const product = await prisma.product.upsert({
      where: { barcode: item.barcode },
      create: {
        barcode: item.barcode,
        name: item.name,
        defaultPrice: toDecimal(item.price),
        currency: item.currency,
      },
      update: {
        name: item.name,
        defaultPrice: toDecimal(item.price),
        currency: item.currency,
      },
    });

    await prisma.storeProduct.upsert({
      where: { storeId_productId: { storeId: store.id, productId: product.id } },
      create: {
        storeId: store.id,
        productId: product.id,
        stock: item.stock,
        costPrice: toDecimal(item.costPrice),
        currency: item.currency,
        lowStockThreshold: item.lowStockThreshold ?? 5,
      },
      update: {
        stock: item.stock,
        costPrice: toDecimal(item.costPrice),
        lowStockThreshold: item.lowStockThreshold ?? 5,
      },
    });
  }

  await prisma.$transaction([
    prisma.storeSetting.upsert({
      where: { storeId_key: { storeId: store.id, key: "exchange_rate" } },
      create: { storeId: store.id, key: "exchange_rate", value: "4100" },
      update: {},
    }),
    prisma.storeSetting.upsert({
      where: { storeId_key: { storeId: store.id, key: "locale" } },
      create: { storeId: store.id, key: "locale", value: "en" },
      update: {},
    }),
  ]);

  console.log("\nSeed complete.\n");
  console.log(`Store:        ${store.name} (${store.code}) — id ${store.id}`);
  console.log(`Admin login:  ${adminEmail} / ${adminPassword}`);
  console.log(`Admin PIN:    ${adminPin} (store ${store.code})`);
  console.log(`Terminal:     ${terminal.name} — id ${terminal.id}`);
  if (!existingTerminal) {
    console.log(`Terminal secret (X-Terminal-Secret, dev only, save now): ${devTerminalSecret}`);
  } else {
    console.log(`Terminal already existed — its device secret was not changed.`);
  }
  console.log(`Demo products: ${DEMO_PRODUCTS.length}\n`);
}

main()
  .catch((err) => {
    console.error(err);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
