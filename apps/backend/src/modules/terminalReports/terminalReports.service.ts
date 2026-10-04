import { prisma } from "../../prisma";
import { fromMinorUnits } from "../../lib/money";
import { computeStoreDailySummary } from "../reports/reports.service";

// Order History / Daily Summary on a POS register show the whole store (every
// terminal, plus imported online-pos history), not just that register's own
// local sales. Responses use the snake_case shape the POS screens already
// render from the sidecar's local database, so they work with either source.

const LEGACY_PREFIX = "online-pos:";

async function exchangeRate(storeId: string): Promise<number> {
  const row = await prisma.storeSetting.findUnique({ where: { storeId_key: { storeId, key: "exchange_rate" } } });
  const rate = row ? Number(row.value) : NaN;
  return rate > 0 ? rate : 4100;
}

/**
 * A short number to print for an order: "OP-0123" for an imported online-pos
 * sale (its old order number), otherwise the start of the sale's UUID. The
 * sidecar swaps in its local order number for the register's own sales.
 */
export function receiptNo(clientOrderUuid: string): string {
  if (clientOrderUuid.startsWith(LEGACY_PREFIX)) {
    return `OP-${clientOrderUuid.split(":").pop()!.padStart(4, "0")}`;
  }
  return clientOrderUuid.replace(/-/g, "").slice(0, 6).toUpperCase();
}

export async function listStoreOrders(storeId: string, opts: { dateFrom?: Date; dateTo?: Date; limit: number }) {
  const rate = await exchangeRate(storeId);
  const toUsd = (minor: number, currency: "USD" | "KHR") => {
    const amount = fromMinorUnits(minor, currency);
    return currency === "KHR" ? amount / rate : amount;
  };

  const orders = await prisma.order.findMany({
    where: {
      storeId,
      isDeleted: false,
      createdAt: { ...(opts.dateFrom ? { gte: opts.dateFrom } : {}), ...(opts.dateTo ? { lt: opts.dateTo } : {}) },
    },
    orderBy: { createdAt: "desc" },
    take: opts.limit,
    include: { terminal: { select: { name: true } }, items: { include: { product: { select: { name: true } } } } },
  });

  return orders.map((order) => ({
    id: order.id,
    client_order_uuid: order.clientOrderUuid,
    receipt_no: receiptNo(order.clientOrderUuid),
    terminal_id: order.terminalId,
    terminal_name: order.terminal.name,
    created_at: order.createdAt.toISOString(),
    // The POS screens treat total_amount as USD and convert for display.
    total_amount: toUsd(order.totalAmountMinor, order.currency),
    payment_method: order.paymentMethod,
    bank_name: order.bankName,
    amount_paid_usd: fromMinorUnits(order.amountPaidUsdMinor, "USD"),
    amount_paid_khr: fromMinorUnits(order.amountPaidKhrMinor, "KHR"),
    change_given_khr: fromMinorUnits(order.changeGivenKhrMinor, "KHR"),
    status: order.status,
    items: order.items.map((item) => ({
      product_name: item.product.name,
      quantity: item.quantity,
      price: fromMinorUnits(item.priceAtSaleMinor, item.currency),
      currency: item.currency,
    })),
  }));
}

export async function storeDailySummary(storeId: string, dateFrom: Date, dateTo: Date) {
  const s = await computeStoreDailySummary(storeId, dateFrom, dateTo);
  return {
    order_count: s.orderCount,
    total_revenue: s.totalRevenue,
    avg_order: s.avgOrder,
    gross_profit: s.grossProfit,
    by_method: s.byMethod.map((m) => ({ payment_method: m.paymentMethod, count: m.count, total: m.total })),
    top_products: s.topProducts.map((p) => ({ name: p.name, total_qty: p.totalQty, revenue: p.revenue })),
  };
}
