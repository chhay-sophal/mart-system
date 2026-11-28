// Fills a LOCAL dev database with ~14 months of realistic sales history, for
// working on Reports and Analytics. Run after the base seed (prisma/seed.ts)
// or on a dev DB that already has a store, a register and products.
//
//   pnpm db:seed:sales            # (re)generate the history
//   pnpm db:seed:sales --clear    # remove it again
//
// Every generated order's clientOrderUuid starts with "devseed-", so the
// script only ever replaces its own orders; anything else in the database is
// left alone. Stock levels aren't changed. A fixed random seed makes the
// output the same on every run. Refuses to run against anything but a local
// file: database, so it can never write to production.
import { randomUUID } from "node:crypto";
import { prisma } from "../src/prisma";
import { env } from "../src/env";
import { addDays, datesBetween, weekdayOf, zonedMidnight } from "../src/lib/zonedTime";

const PREFIX = "devseed-";
const MONTHS = 14;
const BATCH = 500;

if (!env.DATABASE_URL.startsWith("file:")) {
  console.error("seed-sales only runs against a local file: database (DATABASE_URL), never a real one.");
  process.exit(1);
}

// Deterministic random numbers (mulberry32), so every run makes the same data.
let state = 20261128;
function random() {
  state = (state + 0x6d2b79f5) | 0;
  let t = Math.imul(state ^ (state >>> 15), 1 | state);
  t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
  return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
}
const pick = <T>(items: T[], weights: number[]): T => {
  const total = weights.reduce((a, b) => a + b, 0);
  let r = random() * total;
  for (let i = 0; i < items.length; i++) {
    r -= weights[i]!;
    if (r <= 0) return items[i]!;
  }
  return items[items.length - 1]!;
};

// Busier at the weekend (Monday first) and at breakfast, lunch and after work.
const WEEKDAY_FACTOR = [0.85, 0.85, 0.9, 0.95, 1.1, 1.3, 1.25];
const HOURS = Array.from({ length: 15 }, (_, i) => i + 7); // 7:00 - 21:00
const HOUR_WEIGHTS = [6, 8, 5, 4, 7, 9, 8, 4, 3, 4, 7, 9, 8, 5, 3];
const ITEM_COUNTS = [1, 2, 3, 4, 5, 6];
const ITEM_COUNT_WEIGHTS = [30, 28, 18, 12, 7, 5];

// Khmer New Year spike (mid-April), a lift towards the end of the year.
function seasonFactor(date: string): number {
  const md = date.slice(5);
  if (md >= "04-12" && md <= "04-16") return 1.6;
  if (md >= "12-15") return 1.15;
  return 1;
}

async function clear(storeId: string) {
  const removed = await prisma.order.deleteMany({ where: { clientOrderUuid: { startsWith: PREFIX } } });
  // Removing orders leaves no trace Analytics' change detection could see,
  // so its totals are dropped and rebuilt from scratch on the next view.
  await prisma.$transaction([
    prisma.dailyProductStat.deleteMany({ where: { storeId } }),
    prisma.dailyStoreStat.deleteMany({ where: { storeId } }),
    prisma.statsCursor.deleteMany({ where: { storeId } }),
  ]);
  return removed.count;
}

async function main() {
  const store = await prisma.store.findFirst({ where: { code: "MAIN" } }) ?? (await prisma.store.findFirst());
  if (!store) throw new Error("No store found: run the base seed first (pnpm db:seed).");
  const terminal = await prisma.terminal.findFirst({ where: { storeId: store.id, isActive: true } });
  if (!terminal) throw new Error(`No active register in ${store.name}: run the base seed first.`);

  const removed = await clear(store.id);
  console.log(`Removed ${removed} previously generated order(s) from ${store.name}.`);
  if (process.argv.includes("--clear")) return;

  const cashiers = (await prisma.userStoreRole.findMany({ where: { storeId: store.id }, select: { userId: true } })).map((r) => r.userId);
  const rateSetting = await prisma.storeSetting.findUnique({ where: { storeId_key: { storeId: store.id, key: "exchange_rate" } } });
  const mainSetting = await prisma.storeSetting.findUnique({ where: { storeId_key: { storeId: store.id, key: "main_currency" } } });
  const baseRate = Number(rateSetting?.value) || 4100;
  const mainCurrency = mainSetting?.value === "KHR" ? "KHR" : "USD";

  const storeProducts = await prisma.storeProduct.findMany({
    where: { storeId: store.id, product: { isDeleted: false } },
    include: { product: true },
  });
  const catalog = storeProducts
    .map((sp) => ({
      productId: sp.productId,
      name: sp.product.name,
      priceMinor: sp.priceOverrideMinor ?? sp.product.defaultPriceMinor,
      currency: sp.priceOverrideMinor !== null ? sp.currency : sp.product.currency,
      costMinor: sp.costPriceMinor > 0 ? sp.costPriceMinor : null,
      costCurrency: sp.costPriceMinor > 0 ? sp.currency : null,
    }))
    .filter((p) => p.priceMinor > 0);
  if (catalog.length < 10) throw new Error("Need at least 10 priced products in the store.");

  // Popularity: a shuffled catalogue, the first items selling far more than
  // the long tail (Zipf-like).
  for (let i = catalog.length - 1; i > 0; i--) {
    const j = Math.floor(random() * (i + 1));
    [catalog[i], catalog[j]] = [catalog[j]!, catalog[i]!];
  }
  const baseWeights = catalog.map((_, i) => 1 / Math.pow(i + 1, 1.05));

  // A few popular products change in the last four weeks, for Product movers.
  const today = new Date().toLocaleDateString("en-CA", { timeZone: store.timezone });
  const moversFrom = addDays(today, -27);
  const rising = catalog.slice(5, 8).map((p) => p.productId);
  const falling = catalog.slice(8, 11).map((p) => p.productId);
  const stopped = catalog.slice(11, 14).map((p) => p.productId);
  const recentWeights = catalog.map((p, i) =>
    rising.includes(p.productId) ? baseWeights[i]! * 4 : falling.includes(p.productId) ? baseWeights[i]! * 0.35 : stopped.includes(p.productId) ? 0 : baseWeights[i]!
  );

  const from = addDays(today, -Math.round(MONTHS * 30.4));
  const dates = datesBetween(from, today);
  const now = Date.now();
  let orders: Array<Record<string, unknown>> = [];
  let items: Array<Record<string, unknown>> = [];
  let orderTotal = 0;
  let itemTotal = 0;

  const flush = async () => {
    if (orders.length) await prisma.order.createMany({ data: orders as never });
    if (items.length) await prisma.orderItem.createMany({ data: items as never });
    orderTotal += orders.length;
    itemTotal += items.length;
    orders = [];
    items = [];
  };

  for (const [dayIndex, date] of dates.entries()) {
    // Steady growth over the period (+30%), weekly rhythm, season, noise.
    const growth = 1 + 0.3 * (dayIndex / dates.length);
    const expected = 70 * growth * WEEKDAY_FACTOR[weekdayOf(date)]! * seasonFactor(date) * (0.85 + random() * 0.3);
    const count = Math.round(expected);
    const weights = date >= moversFrom ? recentWeights : baseWeights;
    // The rate drifts a little over time, like the real one.
    const rate = Math.round(baseRate + 20 * Math.sin(dayIndex / 40));
    const dayStart = zonedMidnight(date, store.timezone).getTime();

    for (let n = 0; n < count; n++) {
      const hour = pick(HOURS, HOUR_WEIGHTS);
      const createdAt = new Date(dayStart + hour * 3_600_000 + Math.floor(random() * 3_600_000));
      if (createdAt.getTime() > now) continue;

      const orderId = randomUUID();
      const lineCount = pick(ITEM_COUNTS, ITEM_COUNT_WEIGHTS);
      const used = new Set<string>();
      let totalKhr = 0;
      for (let l = 0; l < lineCount; l++) {
        const product = pick(catalog, weights);
        if (used.has(product.productId)) continue;
        used.add(product.productId);
        const quantity = random() < 0.7 ? 1 : random() < 0.66 ? 2 : 3 + Math.floor(random() * 2);
        // Now and then a line discount (a damaged pack, a promotion): ~10%.
        const discountMinor = random() < 0.05 ? Math.round(product.priceMinor * quantity * 0.1) : 0;
        const lineMinor = product.priceMinor * quantity - discountMinor;
        totalKhr += product.currency === "KHR" ? lineMinor : (lineMinor / 100) * rate;
        items.push({
          id: randomUUID(),
          orderId,
          productId: product.productId,
          quantity,
          priceAtSaleMinor: product.priceMinor,
          discountMinor,
          currency: product.currency,
          costAtSaleMinor: product.costMinor,
          costCurrency: product.costCurrency,
        });
      }
      if (!used.size) continue;

      // Charged in the store's main currency, riel to the nearest 100.
      const totalKhrRounded = Math.max(100, Math.round(totalKhr / 100) * 100);
      const totalMinor = mainCurrency === "KHR" ? totalKhrRounded : Math.round((totalKhr / rate) * 100);
      const totalUsd = totalKhrRounded / rate;
      const paymentMethod = pick(["CASH", "KHQR", "STATIC_QR"] as const, [60, 25, 15]);
      let amountPaidUsdMinor = 0;
      let amountPaidKhrMinor = 0;
      let changeGivenKhrMinor = 0;
      if (paymentMethod === "CASH") {
        // Paid in riel notes, rounded up to the next 5,000.
        amountPaidKhrMinor = Math.ceil(totalKhrRounded / 5000) * 5000;
        changeGivenKhrMinor = amountPaidKhrMinor - totalKhrRounded;
      } else {
        amountPaidUsdMinor = Math.round(totalUsd * 100);
      }

      orders.push({
        id: orderId,
        storeId: store.id,
        terminalId: terminal.id,
        clientOrderUuid: `${PREFIX}${date}-${n}`,
        cashierUserId: cashiers.length ? cashiers[Math.floor(random() * cashiers.length)] : null,
        totalAmountMinor: totalMinor,
        currency: mainCurrency,
        paymentMethod,
        bankName: paymentMethod === "STATIC_QR" ? (random() < 0.7 ? "ABA" : "ACLEDA") : null,
        amountPaidUsdMinor,
        amountPaidKhrMinor,
        changeGivenKhrMinor,
        exchangeRate: rate,
        status: random() < 0.01 ? "VOIDED" : "COMPLETED",
        createdAt,
        syncedAt: new Date(createdAt.getTime() + 30_000),
      });

      if (orders.length >= BATCH) await flush();
    }
  }
  await flush();

  console.log(`\nGenerated ${orderTotal.toLocaleString()} orders (${itemTotal.toLocaleString()} lines) for ${store.name}, ${from} to ${today}.`);
  console.log(`Rising in the last 4 weeks:  ${catalog.slice(5, 8).map((p) => p.name).join(", ")}`);
  console.log(`Falling:                     ${catalog.slice(8, 11).map((p) => p.name).join(", ")}`);
  console.log(`Stopped selling:             ${catalog.slice(11, 14).map((p) => p.name).join(", ")}`);
  console.log(`Remove with: pnpm db:seed:sales --clear\n`);
}

main()
  .catch((err) => {
    console.error(err);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
