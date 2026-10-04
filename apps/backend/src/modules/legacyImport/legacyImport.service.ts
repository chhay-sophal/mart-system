import { Prisma, type PaymentMethod } from "@prisma/client";
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

type Tx = Prisma.TransactionClient;

async function getLegacyTerminalId(tx: Tx, storeId: string): Promise<string> {
  const existing = await tx.terminal.findFirst({ where: { storeId, name: LEGACY_TERMINAL_NAME } });
  if (existing) return existing.id;
  const created = await tx.terminal.create({
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

/**
 * Items are matched to the catalog by barcode (by name when there's none).
 * A product that's gone -- deleted in online-pos, so the product import left
 * it out -- is created as deleted, so the sale still shows what was sold.
 */
async function resolveProductId(
  tx: Tx,
  item: LegacyOrder["items"][number],
  cache: Map<string, string>,
  result: LegacyOrderImportResult
): Promise<string> {
  const barcode = item.barcode?.trim() || null;
  const key = barcode ? `barcode:${barcode}` : `name:${item.name}`;
  const cached = cache.get(key);
  if (cached) return cached;

  let product = barcode
    ? await tx.product.findUnique({ where: { barcode } })
    : await tx.product.findFirst({ where: { name: item.name, barcode: null } });
  if (!product) {
    product = await tx.product.create({
      data: {
        name: item.name,
        barcode,
        defaultPriceMinor: toMinorUnits(item.priceAtSale, item.currency),
        currency: item.currency,
        isDeleted: true,
      },
    });
    result.productsCreated += 1;
  }
  cache.set(key, product.id);
  return product.id;
}

/**
 * Imports historical sales from an online-pos database. Unlike sync push,
 * this never touches stock: the product import already brought over stock
 * levels that reflect these sales.
 */
export async function importLegacyOrders(
  storeId: string,
  sourceId: string,
  rawOrders: unknown[]
): Promise<LegacyOrderImportResult> {
  const store = await getStoreOrThrow(storeId);
  const result: LegacyOrderImportResult = { imported: 0, skipped: 0, productsCreated: 0, errors: [] };

  await prisma.$transaction(
    async (tx) => {
      const terminalId = await getLegacyTerminalId(tx, storeId);
      const productCache = new Map<string, string>();

      for (const raw of rawOrders) {
        const parsed = legacyOrderSchema.safeParse(raw);
        if (!parsed.success) {
          const legacyId = (raw as { legacyId?: unknown } | null)?.legacyId ?? null;
          const reason = parsed.error.issues.map((i) => `${i.path.join(".")}: ${i.message}`).join("; ");
          result.errors.push({ legacyId, error: `Invalid order — ${reason}` });
          continue;
        }
        const order = parsed.data;
        const clientOrderUuid = `online-pos:${sourceId}:${order.legacyId}`;

        try {
          if (await tx.order.findUnique({ where: { clientOrderUuid } })) {
            result.skipped += 1;
            continue;
          }
          const paymentMethod = order.paymentMethod.toUpperCase() as PaymentMethod;
          if (!PAYMENT_METHODS.includes(paymentMethod)) {
            result.errors.push({ legacyId: order.legacyId, error: `Unknown payment method "${order.paymentMethod}"` });
            continue;
          }

          const items = [];
          for (const item of order.items) {
            items.push({
              productId: await resolveProductId(tx, item, productCache, result),
              quantity: item.quantity,
              priceAtSaleMinor: toMinorUnits(item.priceAtSale, item.currency),
              currency: item.currency,
            });
          }

          await tx.order.create({
            data: {
              storeId,
              terminalId,
              clientOrderUuid,
              totalAmountMinor: toMinorUnits(order.totalAmount, order.currency),
              currency: order.currency,
              paymentMethod,
              bankName: order.bankName,
              amountPaidUsdMinor: toMinorUnits(order.amountPaidUsd, "USD"),
              amountPaidKhrMinor: toMinorUnits(order.amountPaidKhr, "KHR"),
              changeGivenKhrMinor: toMinorUnits(order.changeGivenKhr, "KHR"),
              status: order.status.toUpperCase() === "VOIDED" ? "VOIDED" : "COMPLETED",
              isDeleted: order.isDeleted,
              createdAt: zonedLocalToUtc(order.createdAt, store.timezone),
              items: { create: items },
            },
          });
          result.imported += 1;
        } catch (err) {
          logger.error({ err, storeId, legacyId: order.legacyId }, "importLegacyOrders order failed");
          result.errors.push({ legacyId: order.legacyId, error: err instanceof Error ? err.message : "Unknown error" });
        }
      }
    },
    // A 200-order batch runs ~1k queries; Prisma's 5s default is too tight on a remote DB.
    { timeout: 60_000 }
  );

  return result;
}
