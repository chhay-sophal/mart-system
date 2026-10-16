import { computeStoreDailySummary } from "../reports/reports.service";
import { listOrders } from "../orders/orders.service";

// Order History / Daily Summary on a POS register show the whole store (every
// terminal, plus imported online-pos history), not just that register's own
// local sales. Rows come from orders.service in the snake_case shape the POS
// screens already render from the sidecar's local database.

export async function listStoreOrders(storeId: string, opts: { dateFrom?: Date; dateTo?: Date; limit: number }) {
  return listOrders({ storeIds: [storeId], ...opts });
}

type SummaryProduct = Awaited<ReturnType<typeof computeStoreDailySummary>>["allProducts"][number];

const toPosProduct = (p: SummaryProduct) => ({
  name: p.name,
  total_qty: p.totalQty,
  revenue: p.revenue,
  revenue_khr: p.revenueKhr,
  // Null when none of the units sold had a cost price.
  profit: p.profit,
  profit_khr: p.profitKhr,
});

export async function storeDailySummary(storeId: string, dateFrom: Date, dateTo: Date) {
  const s = await computeStoreDailySummary(storeId, dateFrom, dateTo);
  return {
    order_count: s.orderCount,
    total_revenue: s.totalRevenue,
    total_revenue_khr: s.totalRevenueKhr,
    avg_order: s.avgOrder,
    avg_order_khr: s.avgOrderKhr,
    gross_profit: s.grossProfit,
    gross_profit_khr: s.grossProfitKhr,
    uncosted_revenue: s.uncostedRevenue,
    uncosted_revenue_khr: s.uncostedRevenueKhr,
    uncosted_product_count: s.uncostedProducts.length,
    by_method: s.byMethod.map((m) => ({ payment_method: m.paymentMethod, count: m.count, total: m.total, total_khr: m.totalKhr })),
    top_products: s.topProducts.map(toPosProduct),
    all_products: s.allProducts.map(toPosProduct),
  };
}
