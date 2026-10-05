import { computeStoreDailySummary } from "../reports/reports.service";
import { listOrders } from "../orders/orders.service";

// Order History / Daily Summary on a POS register show the whole store (every
// terminal, plus imported online-pos history), not just that register's own
// local sales. Rows come from orders.service in the snake_case shape the POS
// screens already render from the sidecar's local database.

export async function listStoreOrders(storeId: string, opts: { dateFrom?: Date; dateTo?: Date; limit: number }) {
  return listOrders({ storeIds: [storeId], ...opts });
}

export async function storeDailySummary(storeId: string, dateFrom: Date, dateTo: Date) {
  const s = await computeStoreDailySummary(storeId, dateFrom, dateTo);
  return {
    order_count: s.orderCount,
    total_revenue: s.totalRevenue,
    total_revenue_khr: s.totalRevenueKhr,
    avg_order: s.avgOrder,
    avg_order_khr: s.avgOrderKhr,
    gross_profit: s.grossProfit,
    by_method: s.byMethod.map((m) => ({ payment_method: m.paymentMethod, count: m.count, total: m.total, total_khr: m.totalKhr })),
    top_products: s.topProducts.map((p) => ({ name: p.name, total_qty: p.totalQty, revenue: p.revenue })),
  };
}
