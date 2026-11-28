import { prisma } from "../../prisma";
import { fromMinorUnits, toMinorUnits } from "../../lib/money";
import { addDays, datesBetween, weekdayOf, zonedDateHour, zonedMidnight } from "../../lib/zonedTime";
import { computeStoreDailySummary, resolveAccessibleStoreIds, type ReportUser } from "../reports/reports.service";

// The Analytics page reads pre-totalled days (DailyStoreStat, DailyProductStat)
// instead of every order: a year of trends is ~365 rows per store.
//
// Keeping them current without touching every place orders are written: each
// request first looks for orders updated since the store's StatsCursor (the
// Order(storeId, updatedAt) index makes that cheap) -- their days are redone
// if they're in the requested range, marked stale otherwise -- then works out
// any requested day that's missing or stale. Days are worked out with the
// same rules as Reports (computeStoreDailySummary), so the two always agree.

/** Product movers compare the latest four weeks with the four before. */
export const MOVERS_WINDOW_DAYS = 28;

type HourlyEntry = [orders: number, revenueMinor: number, revenueKhr: number];

async function storeTimezone(storeId: string): Promise<string> {
  const store = await prisma.store.findUnique({ where: { id: storeId }, select: { timezone: true } });
  return store?.timezone || "Asia/Phnom_Penh";
}

// At most this many days are worked out in one pass, so a first look at a
// long range (a year, plus the year before to compare) never loads years of
// orders into memory at once.
const MAX_SPAN_DAYS = 31;

// Consecutive dates grouped into [from, to] spans of up to MAX_SPAN_DAYS, so
// a run of days is worked out with one pass over its orders.
function spansOf(dates: string[]): Array<[string, string]> {
  const sorted = [...new Set(dates)].sort();
  const spans: Array<[string, string]> = [];
  let length = 0;
  for (const date of sorted) {
    const last = spans[spans.length - 1];
    if (last && addDays(last[1], 1) === date && length < MAX_SPAN_DAYS) {
      last[1] = date;
      length++;
    } else {
      spans.push([date, date]);
      length = 1;
    }
  }
  return spans;
}

// Works out and saves the stats of every day in [from, to] (local dates).
async function computeDays(storeId: string, timeZone: string, from: string, to: string) {
  const summary = await computeStoreDailySummary(storeId, zonedMidnight(from, timeZone), zonedMidnight(addDays(to, 1), timeZone), {
    dayOf: (at) => zonedDateHour(at, timeZone).date,
  });

  const days = new Map(
    datesBetween(from, to).map((date) => [
      date,
      {
        orderCount: 0,
        revenue: 0,
        revenueKhr: 0,
        profit: 0,
        profitKhr: 0,
        hourly: Array.from({ length: 24 }, (): HourlyEntry => [0, 0, 0]),
      },
    ])
  );
  for (const slot of summary.timeline) {
    const { date, hour } = zonedDateHour(new Date(slot.hour), timeZone);
    const day = days.get(date);
    if (!day) continue;
    day.orderCount += slot.orderCount;
    day.revenue += slot.revenue;
    day.revenueKhr += slot.revenueKhr;
    day.profit += slot.profit;
    day.profitKhr += slot.profitKhr;
    const entry = day.hourly[hour]!;
    entry[0] += slot.orderCount;
    entry[1] += toMinorUnits(slot.revenue, "USD");
    entry[2] += Math.round(slot.revenueKhr);
  }

  const dates = [...days.keys()];
  await prisma.$transaction([
    ...[...days.entries()].map(([date, d]) => {
      const data = {
        orderCount: d.orderCount,
        revenueMinor: toMinorUnits(d.revenue, "USD"),
        revenueKhr: Math.round(d.revenueKhr),
        grossProfitMinor: toMinorUnits(d.profit, "USD"),
        grossProfitKhr: Math.round(d.profitKhr),
        hourly: JSON.stringify(d.hourly),
        stale: false,
      };
      return prisma.dailyStoreStat.upsert({
        where: { storeId_date: { storeId, date } },
        create: { storeId, date, ...data },
        update: data,
      });
    }),
    prisma.dailyProductStat.deleteMany({ where: { storeId, date: { in: dates } } }),
    prisma.dailyProductStat.createMany({
      data: [...summary.productsByDay.entries()].flatMap(([date, products]) =>
        [...products.entries()].map(([productId, p]) => ({
          storeId,
          date,
          productId,
          quantity: p.qty,
          revenueMinor: toMinorUnits(p.revenue, "USD"),
          revenueKhr: Math.round(p.revenueKhr),
        }))
      ),
    }),
  ]);
}

/** Makes sure a store's stats for every day in [from, to] are worked out and current. */
export async function refreshDailyStats(storeId: string, from: string, to: string) {
  const timeZone = await storeTimezone(storeId);
  // Taken before looking, so an order changed while this runs is caught next time.
  const now = new Date();
  const cursor = await prisma.statsCursor.findUnique({ where: { storeId } });

  const dirty = new Set<string>();
  if (cursor) {
    const changed = await prisma.order.findMany({
      where: { storeId, updatedAt: { gt: cursor.computedThrough } },
      select: { createdAt: true },
    });
    for (const order of changed) dirty.add(zonedDateHour(order.createdAt, timeZone).date);
  }
  const outside = [...dirty].filter((date) => date < from || date > to);
  if (outside.length) {
    await prisma.dailyStoreStat.updateMany({ where: { storeId, date: { in: outside } }, data: { stale: true } });
  }

  const existing = await prisma.dailyStoreStat.findMany({
    where: { storeId, date: { gte: from, lte: to } },
    select: { date: true, stale: true },
  });
  const fresh = new Set(existing.filter((row) => !row.stale && !dirty.has(row.date)).map((row) => row.date));
  const todo = datesBetween(from, to).filter((date) => !fresh.has(date));

  for (const [spanFrom, spanTo] of spansOf(todo)) await computeDays(storeId, timeZone, spanFrom, spanTo);

  await prisma.statsCursor.upsert({
    where: { storeId },
    create: { storeId, computedThrough: now },
    update: { computedThrough: now },
  });
}

type DayTotals = { date: string; orderCount: number; revenue: number; revenueKhr: number; profit: number; profitKhr: number };
type ProductTotals = { qty: number; revenue: number; revenueKhr: number };

/**
 * Trends for one store or every store the user can see, over [from, to]
 * (local dates): each day's totals, the same for the period of the same
 * length before (for comparison), when in the week and day sales happen, and
 * product movers (the latest four weeks against the four before).
 */
export async function getAnalytics(user: ReportUser, { storeId, from, to }: { storeId?: string; from: string; to: string }) {
  const storeIds = await resolveAccessibleStoreIds(user, storeId);
  const length = datesBetween(from, to).length;
  const prevFrom = addDays(from, -length);
  const prevTo = addDays(from, -1);
  const moversFrom = addDays(to, -(MOVERS_WINDOW_DAYS - 1));
  const moversPrevFrom = addDays(to, -(2 * MOVERS_WINDOW_DAYS - 1));
  const moversPrevTo = addDays(moversFrom, -1);
  const earliest = prevFrom < moversPrevFrom ? prevFrom : moversPrevFrom;

  for (const id of storeIds) await refreshDailyStats(id, earliest, to);

  const [stats, productStats, mainCurrencies] = await Promise.all([
    prisma.dailyStoreStat.findMany({ where: { storeId: { in: storeIds }, date: { gte: earliest, lte: to } } }),
    prisma.dailyProductStat.findMany({ where: { storeId: { in: storeIds }, date: { gte: moversPrevFrom, lte: to } } }),
    prisma.storeSetting.findMany({ where: { storeId: { in: storeIds }, key: "main_currency" } }),
  ]);

  // Days summed across stores.
  const byDate = new Map<string, DayTotals>();
  const heatmap = Array.from({ length: 7 }, () => Array.from({ length: 24 }, () => ({ orders: 0, revenue: 0, revenueKhr: 0 })));
  for (const row of stats) {
    const day = byDate.get(row.date) ?? { date: row.date, orderCount: 0, revenue: 0, revenueKhr: 0, profit: 0, profitKhr: 0 };
    day.orderCount += row.orderCount;
    day.revenue += fromMinorUnits(row.revenueMinor, "USD");
    day.revenueKhr += row.revenueKhr;
    day.profit += fromMinorUnits(row.grossProfitMinor, "USD");
    day.profitKhr += row.grossProfitKhr;
    byDate.set(row.date, day);
    if (row.date >= from && row.date <= to) {
      const weekday = weekdayOf(row.date);
      (JSON.parse(row.hourly) as HourlyEntry[]).forEach(([orders, revenueMinor, revenueKhr], hour) => {
        const cell = heatmap[weekday]![hour]!;
        cell.orders += orders;
        cell.revenue += fromMinorUnits(revenueMinor, "USD");
        cell.revenueKhr += revenueKhr;
      });
    }
  }
  const daysOf = (start: string, end: string) =>
    datesBetween(start, end).map((date) => byDate.get(date) ?? { date, orderCount: 0, revenue: 0, revenueKhr: 0, profit: 0, profitKhr: 0 });

  // Product movers: each product's totals in the two windows.
  const movers = new Map<string, { current: ProductTotals; previous: ProductTotals }>();
  for (const row of productStats) {
    const entry = movers.get(row.productId) ?? { current: { qty: 0, revenue: 0, revenueKhr: 0 }, previous: { qty: 0, revenue: 0, revenueKhr: 0 } };
    const window = row.date >= moversFrom ? entry.current : entry.previous;
    window.qty += row.quantity;
    window.revenue += fromMinorUnits(row.revenueMinor, "USD");
    window.revenueKhr += row.revenueKhr;
    movers.set(row.productId, entry);
  }
  const products = await prisma.product.findMany({
    where: { id: { in: [...movers.keys()] } },
    select: { id: true, name: true, barcode: true },
  });
  const productById = new Map(products.map((p) => [p.id, p]));

  return {
    // Lead with riel only when every store in view is a riel store, as Reports does.
    mainCurrency: storeIds.length > 0 && mainCurrencies.length === storeIds.length && mainCurrencies.every((s) => s.value === "KHR") ? "KHR" : "USD",
    range: { from, to, prevFrom, prevTo },
    days: daysOf(from, to),
    previousDays: daysOf(prevFrom, prevTo),
    heatmap,
    movers: {
      range: { from: moversFrom, to, prevFrom: moversPrevFrom, prevTo: moversPrevTo },
      products: [...movers.entries()].map(([productId, m]) => ({
        productId,
        name: productById.get(productId)?.name ?? "",
        barcode: productById.get(productId)?.barcode ?? null,
        ...m,
      })),
    },
  };
}
