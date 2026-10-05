import type { Prisma } from "@prisma/client";
import { prisma } from "../../prisma";
import { fromMinorUnits } from "../../lib/money";
import { badRequest, notFound } from "../../lib/httpError";
import { resolveAccessibleStoreIds, type ReportUser } from "../reports/reports.service";

// Order lists for POS Order History (terminalReports) and IMS Sales History,
// in the snake_case shape the POS screen was built around, so both render the
// same rows. total + currency are the total as stored (the store's main
// currency at the time of sale); total_amount is the same in USD, for sums and
// sorting across currencies; exchange_rate is the store's rate.

const LEGACY_PREFIX = "online-pos:";
const DEFAULT_EXCHANGE_RATE = 4100;

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

interface StoreMoney {
  rate: number;
  mainCurrency: "USD" | "KHR";
}

/** Each store's exchange rate and main currency (Settings in IMS). */
async function storeMoney(storeIds: string[]): Promise<(storeId: string) => StoreMoney> {
  const rows = await prisma.storeSetting.findMany({
    where: { storeId: { in: storeIds }, key: { in: ["exchange_rate", "main_currency"] } },
  });
  const byStore = new Map<string, StoreMoney>();
  const get = (storeId: string) => byStore.get(storeId) ?? { rate: DEFAULT_EXCHANGE_RATE, mainCurrency: "USD" as const };
  for (const row of rows) {
    const money = { ...get(row.storeId) };
    if (row.key === "exchange_rate" && Number(row.value) > 0) money.rate = Number(row.value);
    if (row.key === "main_currency" && row.value === "KHR") money.mainCurrency = "KHR";
    byStore.set(row.storeId, money);
  }
  return get;
}

const orderInclude = {
  store: { select: { name: true } },
  terminal: { select: { name: true } },
  items: { include: { product: { select: { name: true, barcode: true } } } },
} satisfies Prisma.OrderInclude;

type OrderWithDetails = Prisma.OrderGetPayload<{ include: typeof orderInclude }>;

function toOrderView(order: OrderWithDetails, { rate, mainCurrency }: StoreMoney) {
  const toUsd = (minor: number, currency: "USD" | "KHR") => {
    const amount = fromMinorUnits(minor, currency);
    return currency === "KHR" ? amount / rate : amount;
  };
  return {
    id: order.id,
    client_order_uuid: order.clientOrderUuid,
    receipt_no: receiptNo(order.clientOrderUuid),
    store_id: order.storeId,
    store_name: order.store.name,
    terminal_id: order.terminalId,
    terminal_name: order.terminal.name,
    created_at: order.createdAt.toISOString(),
    total: fromMinorUnits(order.totalAmountMinor, order.currency),
    currency: order.currency,
    total_amount: toUsd(order.totalAmountMinor, order.currency),
    exchange_rate: rate,
    // Which currency the store's screens lead with.
    main_currency: mainCurrency,
    payment_method: order.paymentMethod,
    bank_name: order.bankName,
    amount_paid_usd: fromMinorUnits(order.amountPaidUsdMinor, "USD"),
    amount_paid_khr: fromMinorUnits(order.amountPaidKhrMinor, "KHR"),
    change_given_khr: fromMinorUnits(order.changeGivenKhrMinor, "KHR"),
    status: order.status,
    items: order.items.map((item) => ({
      product_name: item.product.name,
      barcode: item.product.barcode,
      quantity: item.quantity,
      price: fromMinorUnits(item.priceAtSaleMinor, item.currency),
      // Item discount for the whole line; the line charged price × quantity − discount.
      discount: fromMinorUnits(item.discountMinor, item.currency),
      currency: item.currency,
    })),
  };
}

export type OrderView = ReturnType<typeof toOrderView>;

/**
 * Newest first. Voided sales are included (status "VOIDED") so a screen can
 * show or hide them, and so the POS sidecar can tell its own voided sale
 * apart from one the backend hasn't received yet.
 */
export async function listOrders(opts: { storeIds: string[]; dateFrom?: Date; dateTo?: Date; limit: number }): Promise<OrderView[]> {
  if (opts.storeIds.length === 0) return [];
  const [orders, money] = await Promise.all([
    prisma.order.findMany({
      where: {
        storeId: { in: opts.storeIds },
        isDeleted: false,
        createdAt: { ...(opts.dateFrom ? { gte: opts.dateFrom } : {}), ...(opts.dateTo ? { lt: opts.dateTo } : {}) },
      },
      orderBy: { createdAt: "desc" },
      take: opts.limit,
      include: orderInclude,
    }),
    storeMoney(opts.storeIds),
  ]);
  return orders.map((order) => toOrderView(order, money(order.storeId)));
}

/** IMS: one store or every store the user can see. */
export async function listOrdersForUser(
  user: ReportUser,
  opts: { storeId?: string; dateFrom?: Date; dateTo?: Date; limit: number }
): Promise<OrderView[]> {
  const storeIds = await resolveAccessibleStoreIds(user, opts.storeId);
  return listOrders({ ...opts, storeIds });
}

/**
 * Marks a sale VOIDED and puts its items back in stock, with a VOID stock
 * movement per item. Shared by a register's synced void and IMS. Voiding an
 * already-voided sale is a no-op, so a register voiding a sale IMS already
 * voided (or the reverse) doesn't restock twice.
 */
export async function voidOrderInTx(
  tx: Prisma.TransactionClient,
  order: Prisma.OrderGetPayload<{ include: { items: true } }>,
  source: { terminalId?: string; sourceEventId?: string; refType?: string }
): Promise<void> {
  if (order.status === "VOIDED") return;
  await tx.order.update({ where: { id: order.id }, data: { status: "VOIDED" } });
  for (const item of order.items) {
    await tx.stockMovement.create({
      data: {
        storeId: order.storeId,
        productId: item.productId,
        terminalId: source.terminalId ?? null,
        delta: item.quantity,
        reason: "VOID",
        refType: source.refType ?? null,
        refId: source.refType ? order.id : null,
        sourceEventId: source.sourceEventId ?? null,
      },
    });
    await tx.storeProduct.update({
      where: { storeId_productId: { storeId: order.storeId, productId: item.productId } },
      data: { stock: { increment: item.quantity } },
    });
  }
}

/** IMS: void a sale in the given store. */
export async function voidOrder(storeId: string, orderId: string): Promise<OrderView> {
  await prisma.$transaction(async (tx) => {
    const order = await tx.order.findUnique({ where: { id: orderId }, include: { items: true } });
    if (!order || order.storeId !== storeId || order.isDeleted) throw notFound("Order not found");
    if (order.status === "VOIDED") throw badRequest("This sale is already voided");
    await voidOrderInTx(tx, order, { refType: "IMS_VOID" });
  });
  const [order, money] = await Promise.all([
    prisma.order.findUniqueOrThrow({ where: { id: orderId }, include: orderInclude }),
    storeMoney([storeId]),
  ]);
  return toOrderView(order, money(storeId));
}
