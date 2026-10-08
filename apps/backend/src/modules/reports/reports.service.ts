import { prisma } from "../../prisma";
import { forbidden } from "../../lib/httpError";
import { fromMinorUnits, roundKhrToNote } from "../../lib/money";
import { listStoresForUser } from "../stores/stores.service";

export type ReportUser = { id: string; isSuperAdmin: boolean };

/** Every store the caller can see, narrowed to one if `storeId` was requested and is actually accessible to them. */
export async function resolveAccessibleStoreIds(user: ReportUser, storeId?: string): Promise<string[]> {
  const stores = await listStoresForUser(user);
  const accessibleIds = stores.map((store) => store.id);

  if (storeId) {
    if (!accessibleIds.includes(storeId)) throw forbidden("No access to this store");
    return [storeId];
  }

  return accessibleIds;
}

export async function listNegativeStock(user: ReportUser, storeId?: string) {
  const storeIds = await resolveAccessibleStoreIds(user, storeId);

  const rows = await prisma.storeProduct.findMany({
    where: { storeId: { in: storeIds }, stock: { lt: 0 } },
    include: { product: true, store: true },
    orderBy: { stock: "asc" },
  });

  return Promise.all(
    rows.map(async (row) => {
      const recentMovements = await prisma.stockMovement.findMany({
        where: { storeId: row.storeId, productId: row.productId },
        orderBy: { createdAt: "desc" },
        take: 5,
      });

      return {
        storeId: row.storeId,
        storeName: row.store.name,
        productId: row.productId,
        productName: row.product.name,
        barcode: row.product.barcode,
        stock: row.stock,
        recentMovements,
      };
    })
  );
}

/** Ported from online-pos/backend-desktop/server.js:495-550, one store at a time, using Prisma instead of raw SQL. */
export async function computeStoreDailySummary(storeId: string, dateFrom: Date, dateTo: Date) {
  const [exchangeRateSetting, mainCurrencySetting] = await Promise.all([
    prisma.storeSetting.findUnique({ where: { storeId_key: { storeId, key: "exchange_rate" } } }),
    prisma.storeSetting.findUnique({ where: { storeId_key: { storeId, key: "main_currency" } } }),
  ]);
  const rate = exchangeRateSetting ? Number(exchangeRateSetting.value) : 4100;
  const mainCurrency = mainCurrencySetting?.value === "KHR" ? "KHR" : "USD";
  const toUsd = (amount: number, currency: string) => (currency === "KHR" ? amount / rate : amount);

  const orders = await prisma.order.findMany({
    // A voided sale (refunded at the register, or in IMS) is not revenue.
    where: { storeId, isDeleted: false, status: { not: "VOIDED" }, createdAt: { gte: dateFrom, lt: dateTo } },
  });

  const orderCount = orders.length;
  // Each sale's total is stored in the store's main currency at the time (and
  // imported online-pos orders carry their own). Revenue is summed in USD, and
  // also in riel: exact for sales charged in riel, converted for the rest.
  const orderTotalUsd = (order: (typeof orders)[number]) =>
    toUsd(fromMinorUnits(order.totalAmountMinor, order.currency), order.currency);
  const orderTotalKhr = (order: (typeof orders)[number]) =>
    order.currency === "KHR" ? order.totalAmountMinor : roundKhrToNote(orderTotalUsd(order) * rate);
  const totalRevenue = orders.reduce((sum, order) => sum + orderTotalUsd(order), 0);
  const totalRevenueKhr = orders.reduce((sum, order) => sum + orderTotalKhr(order), 0);
  const avgOrder = orderCount > 0 ? totalRevenue / orderCount : 0;
  const avgOrderKhr = orderCount > 0 ? roundKhrToNote(totalRevenueKhr / orderCount) : 0;

  const byMethodMap = new Map<string, { count: number; total: number; totalKhr: number }>();
  for (const order of orders) {
    const entry = byMethodMap.get(order.paymentMethod) ?? { count: 0, total: 0, totalKhr: 0 };
    entry.count += 1;
    entry.total += orderTotalUsd(order);
    entry.totalKhr += orderTotalKhr(order);
    byMethodMap.set(order.paymentMethod, entry);
  }
  const byMethod = [...byMethodMap.entries()]
    .map(([paymentMethod, v]) => ({ paymentMethod, count: v.count, total: v.total, totalKhr: v.totalKhr }))
    .sort((a, b) => b.total - a.total);

  const orderIds = orders.map((order) => order.id);
  const items = orderIds.length
    ? await prisma.orderItem.findMany({ where: { orderId: { in: orderIds } }, include: { product: true } })
    : [];

  const productIds = [...new Set(items.map((item) => item.productId))];
  const storeProducts = productIds.length
    ? await prisma.storeProduct.findMany({ where: { storeId, productId: { in: productIds } } })
    : [];
  const costByProductId = new Map(storeProducts.map((sp) => [sp.productId, { cost: fromMinorUnits(sp.costPriceMinor, sp.currency), currency: sp.currency }]));

  const productAgg = new Map<string, { name: string; qty: number; revenue: number; revenueKhr: number; profit: number; profitKhr: number }>();
  let grossProfit = 0;
  let grossProfitKhr = 0;

  for (const item of items) {
    const priceUsd = toUsd(fromMinorUnits(item.priceAtSaleMinor, item.currency), item.currency);
    // What the line actually charged: item discounts (e.g. a defective unit) come off.
    const discountUsd = toUsd(fromMinorUnits(item.discountMinor, item.currency), item.currency);
    const lineRevenue = priceUsd * item.quantity - discountUsd;
    // Exact when the line was priced in riel; otherwise the raw (unrounded)
    // converted figure. Revenue (shown/handed over as cash) still rounds to
    // the nearest note per line below -- profit doesn't, since it's never a
    // cash amount itself: it's rounded once, at the end, to the nearest riel
    // (see grossProfitKhr's final rounding after the loop).
    const khrNativeRevenue =
      item.currency === "KHR"
        ? fromMinorUnits(item.priceAtSaleMinor, "KHR") * item.quantity - fromMinorUnits(item.discountMinor, "KHR")
        : null;
    const lineRevenueKhrExact = khrNativeRevenue ?? lineRevenue * rate;
    const lineRevenueKhr = khrNativeRevenue ?? roundKhrToNote(lineRevenueKhrExact);

    const agg = productAgg.get(item.productId) ?? { name: item.product.name, qty: 0, revenue: 0, revenueKhr: 0, profit: 0, profitKhr: 0 };
    agg.qty += item.quantity;
    agg.revenue += lineRevenue;
    agg.revenueKhr += lineRevenueKhr;

    const costInfo = costByProductId.get(item.productId);
    const costUsd = costInfo ? toUsd(costInfo.cost, costInfo.currency) : 0;
    const costKhrExact = costInfo ? (costInfo.currency === "KHR" ? costInfo.cost : costUsd * rate) : 0;
    const lineProfit = lineRevenue - costUsd * item.quantity;
    const lineProfitKhr = lineRevenueKhrExact - costKhrExact * item.quantity;
    agg.profit += lineProfit;
    agg.profitKhr += lineProfitKhr;
    productAgg.set(item.productId, agg);

    grossProfit += lineProfit;
    grossProfitKhr += lineProfitKhr;
  }
  // Profit calculation: USD to the nearest cent, riel to the nearest whole
  // riel -- finer-grained than revenue's nearest-note rule above, since
  // profit is a computed figure, not cash that changes hands.
  grossProfit = Math.round(grossProfit * 100) / 100;
  grossProfitKhr = Math.round(grossProfitKhr);

  // topProducts is this sliced to 5, for the on-screen card; allProducts (the
  // full list) backs the print report, which needs every product sold, not
  // just the top ones.
  const allProducts = [...productAgg.entries()]
    .map(([productId, v]) => ({
      productId,
      name: v.name,
      totalQty: v.qty,
      revenue: v.revenue,
      revenueKhr: v.revenueKhr,
      // Same nearest-cent/nearest-riel rounding as the day's total gross profit above.
      profit: Math.round(v.profit * 100) / 100,
      profitKhr: Math.round(v.profitKhr),
    }))
    .sort((a, b) => b.totalQty - a.totalQty);
  const topProducts = allProducts.slice(0, 5);

  return {
    storeId,
    mainCurrency,
    rate,
    orderCount,
    totalRevenue,
    totalRevenueKhr,
    avgOrder,
    avgOrderKhr,
    grossProfit,
    grossProfitKhr,
    byMethod,
    topProducts,
    allProducts,
  };
}

export async function getDailySummary(
  user: ReportUser,
  { storeId, dateFrom, dateTo }: { storeId?: string; dateFrom: Date; dateTo: Date }
) {
  const storeIds = await resolveAccessibleStoreIds(user, storeId);
  const stores = await prisma.store.findMany({ where: { id: { in: storeIds } } });
  const nameById = new Map(stores.map((store) => [store.id, store.name]));

  const byStore = await Promise.all(
    storeIds.map(async (id) => ({ ...(await computeStoreDailySummary(id, dateFrom, dateTo)), storeName: nameById.get(id) ?? "" }))
  );

  const combinedOrderCount = byStore.reduce((sum, s) => sum + s.orderCount, 0);
  const combinedRevenue = byStore.reduce((sum, s) => sum + s.totalRevenue, 0);
  const combinedRevenueKhr = byStore.reduce((sum, s) => sum + s.totalRevenueKhr, 0);
  // Each store's own figure is already rounded; re-round the sum too, since
  // adding several cent/riel-rounded numbers can still drift by a hair of
  // floating-point error.
  const combinedGrossProfit = Math.round(byStore.reduce((sum, s) => sum + s.grossProfit, 0) * 100) / 100;
  const combinedGrossProfitKhr = Math.round(byStore.reduce((sum, s) => sum + s.grossProfitKhr, 0));

  return {
    byStore,
    combined: {
      orderCount: combinedOrderCount,
      totalRevenue: combinedRevenue,
      totalRevenueKhr: combinedRevenueKhr,
      avgOrder: combinedOrderCount > 0 ? combinedRevenue / combinedOrderCount : 0,
      avgOrderKhr: combinedOrderCount > 0 ? roundKhrToNote(combinedRevenueKhr / combinedOrderCount) : 0,
      // Lead with riel only when every store in the report is a riel store.
      mainCurrency: byStore.length > 0 && byStore.every((s) => s.mainCurrency === "KHR") ? "KHR" : "USD",
      grossProfit: combinedGrossProfit,
      grossProfitKhr: combinedGrossProfitKhr,
    },
  };
}
