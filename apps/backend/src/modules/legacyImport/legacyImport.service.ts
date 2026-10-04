import type { PaymentMethod } from "@prisma/client";
import { prisma } from "../../prisma";
import { toMinorUnits } from "../../lib/money";
import { logger } from "../../lib/logger";
import { getStoreOrThrow } from "../stores/stores.service";
import { legacyOrderSchema, type LegacyOrder } from "./legacyImport.schema";

// Imported orders still need a terminal. This one is created inactive, so
// requireTerminal rejects it and it can never be paired or used to log in.
const LEGACY_TERMINAL_NAME = "Legacy import (online-pos)";
const PAYMENT_METHODS: readonly PaymentMethod[] = ["CASH", "KHQR", "CARD", "STATIC_QR"];

export interface LegacyOrderImportResult {
  imported: number;
  skipped: number;
  productsCreated: number;
  errors: Array<{ legacyId: unknown; error: string }>;
}

type LegacyItem = LegacyOrder["items"][number];

async function getLegacyTerminalId(storeId: string): Promise<string> {
  const existing = await prisma.terminal.findFirst({ where: { storeId, name: LEGACY_TERMINAL_NAME } });
  if (existing) return existing.id;
  const created = await prisma.terminal.create({
    data: { storeId, name: LEGACY_TERMINAL_NAME, deviceCredentialHash: "!disabled", isActive: false },
  });
  return created.id;
}

/** "2026-07-06 21:07:44" in `timeZone` -> the UTC instant it refers to. */
export function zonedLocalToUtc(local: string, timeZone: string): Date {
  const [date, time = "00:00:00"] = local.split(/[ T]/);
  const asUtc = new Date(`${date}T${time.length === 5 ? `${time}:00` : time}Z`);
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone,
    hourCycle: "h23",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  }).formatToParts(asUtc);
  const get = (type: string) => Number(parts.find((p) => p.type === type)!.value);
  const zoneOffsetMs =
    Date.UTC(get("year"), get("month") - 1, get("day"), get("hour"), get("minute"), get("second")) - asUtc.getTime();
  return new Date(asUtc.getTime() - zoneOffsetMs);
}

const itemBarcode = (item: LegacyItem) => item.barcode?.trim() || null;
const itemKey = (item: LegacyItem) => {
  const barcode = itemBarcode(item);
  return barcode ? `barcode:${barcode}` : `name:${item.name}`;
};

/**
 * Items are matched to the catalog by barcode (by name when there's none).
 * A product that's gone -- deleted in online-pos, so the product import left
 * it out -- is created as deleted, so the sale still shows what was sold.
 * Returns item key -> product id, in a fixed number of queries.
 */
async function resolveProductIds(items: LegacyItem[], result: LegacyOrderImportResult): Promise<Map<string, string>> {
  const barcodes = [...new Set(items.flatMap((i) => (itemBarcode(i) ? [itemBarcode(i)!] : [])))];
  const names = [...new Set(items.flatMap((i) => (itemBarcode(i) ? [] : [i.name])))];
  const [byBarcode, byName] = await Promise.all([
    barcodes.length ? prisma.product.findMany({ where: { barcode: { in: barcodes } }, select: { id: true, barcode: true } }) : [],
    names.length
      ? prisma.product.findMany({ where: { name: { in: names }, barcode: null }, select: { id: true, name: true } })
      : [],
  ]);
  const ids = new Map<string, string>();
  for (const p of byBarcode) ids.set(`barcode:${p.barcode}`, p.id);
  for (const p of byName) if (!ids.has(`name:${p.name}`)) ids.set(`name:${p.name}`, p.id);

  const missing = new Map<string, LegacyItem>();
  for (const item of items) if (!ids.has(itemKey(item)) && !missing.has(itemKey(item))) missing.set(itemKey(item), item);
  if (missing.size) {
    const created = await prisma.product.createManyAndReturn({
      data: [...missing.values()].map((item) => ({
        name: item.name,
        barcode: itemBarcode(item),
        defaultPriceMinor: toMinorUnits(item.priceAtSale, item.currency),
        currency: item.currency,
        isDeleted: true,
      })),
      select: { id: true, name: true, barcode: true },
    });
    for (const p of created) ids.set(p.barcode ? `barcode:${p.barcode}` : `name:${p.name}`, p.id);
    result.productsCreated += created.length;
  }
  return ids;
}

/**
 * Imports historical sales from an online-pos database. Unlike sync push,
 * this never touches stock: the product import already brought over stock
 * levels that reflect these sales.
 *
 * In production every query is a network round trip to Turso, and Prisma
 * cancels an interactive transaction after 5s, so a batch is a fixed handful
 * of queries (lookups, then bulk inserts) rather than several per order.
 */
export async function importLegacyOrders(
  storeId: string,
  sourceId: string,
  rawOrders: unknown[]
): Promise<LegacyOrderImportResult> {
  const store = await getStoreOrThrow(storeId);
  const result: LegacyOrderImportResult = { imported: 0, skipped: 0, productsCreated: 0, errors: [] };

  // Validate, and drop a legacyId repeated within the batch.
  const orders: Array<LegacyOrder & { clientOrderUuid: string; paymentMethod: PaymentMethod }> = [];
  const seen = new Set<string>();
  for (const raw of rawOrders) {
    const parsed = legacyOrderSchema.safeParse(raw);
    if (!parsed.success) {
      const legacyId = (raw as { legacyId?: unknown } | null)?.legacyId ?? null;
      const reason = parsed.error.issues.map((i) => `${i.path.join(".")}: ${i.message}`).join("; ");
      result.errors.push({ legacyId, error: `Invalid order — ${reason}` });
      continue;
    }
    const order = parsed.data;
    const paymentMethod = order.paymentMethod.toUpperCase() as PaymentMethod;
    if (!PAYMENT_METHODS.includes(paymentMethod)) {
      result.errors.push({ legacyId: order.legacyId, error: `Unknown payment method "${order.paymentMethod}"` });
      continue;
    }
    const clientOrderUuid = `online-pos:${sourceId}:${order.legacyId}`;
    if (seen.has(clientOrderUuid)) {
      result.skipped += 1;
      continue;
    }
    seen.add(clientOrderUuid);
    orders.push({ ...order, clientOrderUuid, paymentMethod });
  }

  const alreadyImported = new Set(
    (
      await prisma.order.findMany({
        where: { clientOrderUuid: { in: orders.map((o) => o.clientOrderUuid) } },
        select: { clientOrderUuid: true },
      })
    ).map((o) => o.clientOrderUuid)
  );
  const toImport = orders.filter((o) => !alreadyImported.has(o.clientOrderUuid));
  result.skipped += orders.length - toImport.length;
  if (toImport.length === 0) return result;

  try {
    const terminalId = await getLegacyTerminalId(storeId);
    const productIds = await resolveProductIds(toImport.flatMap((o) => o.items), result);

    await prisma.$transaction(async (tx) => {
      const created = await tx.order.createManyAndReturn({
        data: toImport.map((order) => ({
          storeId,
          terminalId,
          clientOrderUuid: order.clientOrderUuid,
          totalAmountMinor: toMinorUnits(order.totalAmount, order.currency),
          currency: order.currency,
          paymentMethod: order.paymentMethod,
          bankName: order.bankName,
          amountPaidUsdMinor: toMinorUnits(order.amountPaidUsd, "USD"),
          amountPaidKhrMinor: toMinorUnits(order.amountPaidKhr, "KHR"),
          changeGivenKhrMinor: toMinorUnits(order.changeGivenKhr, "KHR"),
          status: order.status.toUpperCase() === "VOIDED" ? ("VOIDED" as const) : ("COMPLETED" as const),
          isDeleted: order.isDeleted,
          createdAt: zonedLocalToUtc(order.createdAt, store.timezone),
        })),
        select: { id: true, clientOrderUuid: true },
      });
      const orderIds = new Map(created.map((o) => [o.clientOrderUuid, o.id]));
      await tx.orderItem.createMany({
        data: toImport.flatMap((order) =>
          order.items.map((item) => ({
            orderId: orderIds.get(order.clientOrderUuid)!,
            productId: productIds.get(itemKey(item))!,
            quantity: item.quantity,
            priceAtSaleMinor: toMinorUnits(item.priceAtSale, item.currency),
            currency: item.currency,
          }))
        ),
      });
    });
    result.imported += toImport.length;
  } catch (err) {
    // The whole batch rolls back together; report every order in it.
    logger.error({ err, storeId }, "importLegacyOrders batch failed");
    const message = err instanceof Error ? err.message : "Unknown error";
    for (const order of toImport) result.errors.push({ legacyId: order.legacyId, error: message });
  }

  return result;
}
