import type { Currency } from "@mart-system/shared-types";
import { prisma } from "../../prisma";
import { notFound } from "../../lib/httpError";
import { fromMinorUnits, toMinorUnits } from "../../lib/money";
import { logger } from "../../lib/logger";
import type { BulkImportRow } from "./products.schema";
import type { createProductSchema, updateProductSchema } from "./products.schema";
import type { z } from "zod";
import type { Prisma } from "@prisma/client";

type CreateProductInput = z.infer<typeof createProductSchema>;
type UpdateProductInput = z.infer<typeof updateProductSchema>;

type StoreProductWithProduct = Prisma.StoreProductGetPayload<{ include: { product: true } }>;

function toProductView(row: StoreProductWithProduct) {
  return {
    id: row.product.id,
    storeProductId: row.id,
    barcode: row.product.barcode,
    name: row.product.name,
    category: row.product.category,
    currency: row.product.currency,
    defaultPrice: fromMinorUnits(row.product.defaultPriceMinor, row.product.currency),
    priceOverride: row.priceOverrideMinor !== null ? fromMinorUnits(row.priceOverrideMinor, row.currency) : null,
    costPrice: fromMinorUnits(row.costPriceMinor, row.currency),
    stock: row.stock,
    lowStockThreshold: row.lowStockThreshold,
    isDeleted: row.product.isDeleted,
    createdAt: row.product.createdAt,
    updatedAt: row.product.updatedAt,
  };
}

const STORE_PRODUCT_INCLUDE = { product: true } as const;

export async function listProducts(storeId: string) {
  const rows = await prisma.storeProduct.findMany({
    where: { storeId, product: { isDeleted: false } },
    include: STORE_PRODUCT_INCLUDE,
    orderBy: { product: { name: "asc" } },
  });
  return rows.map(toProductView);
}

export async function listLowStock(storeId: string) {
  const rows = await prisma.storeProduct.findMany({
    where: { storeId, product: { isDeleted: false } },
    include: STORE_PRODUCT_INCLUDE,
  });
  return rows.filter((row) => row.stock <= row.lowStockThreshold).map(toProductView);
}

async function getStoreProductOrThrow(storeId: string, productId: string) {
  const row = await prisma.storeProduct.findUnique({
    where: { storeId_productId: { storeId, productId } },
    include: STORE_PRODUCT_INCLUDE,
  });
  if (!row || row.product.isDeleted) throw notFound("Product not found");
  return row;
}

export async function getProduct(storeId: string, productId: string) {
  return toProductView(await getStoreProductOrThrow(storeId, productId));
}

export async function createProduct(storeId: string, input: CreateProductInput) {
  const row = await prisma.$transaction(async (tx) => {
    const product = await tx.product.create({
      data: {
        name: input.name,
        barcode: input.barcode ?? null,
        category: input.category ?? null,
        defaultPriceMinor: toMinorUnits(input.price, input.currency as Currency),
        currency: input.currency as Currency,
      },
    });

    return tx.storeProduct.create({
      data: {
        storeId,
        productId: product.id,
        stock: input.stock,
        costPriceMinor: toMinorUnits(input.costPrice, input.currency as Currency),
        currency: input.currency as Currency,
        lowStockThreshold: input.lowStockThreshold,
        priceOverrideMinor: input.priceOverride !== undefined && input.priceOverride !== null ? toMinorUnits(input.priceOverride, input.currency as Currency) : input.priceOverride,
      },
      include: STORE_PRODUCT_INCLUDE,
    });
  });

  return toProductView(row);
}

export async function updateProduct(storeId: string, productId: string, input: UpdateProductInput) {
  const existing = await getStoreProductOrThrow(storeId, productId);
  // A partial update may change price/costPrice/priceOverride without also
  // supplying currency in the same call — fall back to the product's current
  // currency (Product.currency and StoreProduct.currency are always kept in
  // sync by this same function, so either one is a valid fallback here).
  const effectiveCurrency = (input.currency as Currency | undefined) ?? existing.currency;

  const row = await prisma.$transaction(async (tx) => {
    if (
      input.name !== undefined ||
      input.barcode !== undefined ||
      input.category !== undefined ||
      input.price !== undefined ||
      input.currency !== undefined
    ) {
      await tx.product.update({
        where: { id: productId },
        data: {
          name: input.name,
          barcode: input.barcode,
          category: input.category,
          defaultPriceMinor: input.price !== undefined ? toMinorUnits(input.price, effectiveCurrency) : undefined,
          currency: input.currency as Currency | undefined,
        },
      });
    }

    if (
      input.stock !== undefined ||
      input.costPrice !== undefined ||
      input.lowStockThreshold !== undefined ||
      input.currency !== undefined ||
      input.priceOverride !== undefined
    ) {
      await tx.storeProduct.update({
        where: { storeId_productId: { storeId, productId } },
        data: {
          stock: input.stock,
          costPriceMinor: input.costPrice !== undefined ? toMinorUnits(input.costPrice, effectiveCurrency) : undefined,
          lowStockThreshold: input.lowStockThreshold,
          currency: input.currency as Currency | undefined,
          priceOverrideMinor: input.priceOverride !== undefined && input.priceOverride !== null ? toMinorUnits(input.priceOverride, effectiveCurrency) : input.priceOverride,
        },
      });
    }

    return tx.storeProduct.findUniqueOrThrow({
      where: { storeId_productId: { storeId, productId } },
      include: STORE_PRODUCT_INCLUDE,
    });
  });

  return toProductView(row);
}

export async function deleteProduct(storeId: string, productId: string) {
  await getStoreProductOrThrow(storeId, productId);
  await prisma.product.update({ where: { id: productId }, data: { isDeleted: true } });
}

/**
 * Same soft-delete as deleteProduct above, batched. Silently drops any id
 * that isn't actually in this store's catalog (already deleted, or never
 * belonged here) rather than failing the whole batch over it -- the caller
 * only has a snapshot of what was on screen when they selected rows.
 */
export async function bulkDeleteProducts(storeId: string, productIds: string[]): Promise<{ deleted: number }> {
  const rows = await prisma.storeProduct.findMany({
    where: { storeId, productId: { in: productIds }, product: { isDeleted: false } },
    select: { productId: true },
  });
  if (rows.length === 0) return { deleted: 0 };

  await prisma.product.updateMany({
    where: { id: { in: rows.map((r) => r.productId) } },
    data: { isDeleted: true },
  });
  return { deleted: rows.length };
}

/**
 * Sets a store's stock to a manager-supplied corrected count, leaving an
 * audit-tracked ADJUSTMENT ledger row — unlike the plain PUT above, which
 * writes StoreProduct.stock directly with no ledger entry. Used by the
 * negative-stock reconciliation report to make it actionable, not just a list.
 */
export async function adjustStock(storeId: string, productId: string, correctedStock: number) {
  const existing = await getStoreProductOrThrow(storeId, productId);
  const delta = correctedStock - existing.stock;

  const row = await prisma.$transaction(async (tx) => {
    await tx.stockMovement.create({
      data: { storeId, productId, delta, reason: "ADJUSTMENT", refType: "RECONCILIATION" },
    });
    return tx.storeProduct.update({
      where: { storeId_productId: { storeId, productId } },
      data: { stock: correctedStock },
      include: STORE_PRODUCT_INCLUDE,
    });
  });

  return toProductView(row);
}

// --- Bulk import, ported from online-pos/backend-desktop/server.js:165-204 ---

function toTrimmedStringOrNull(value: unknown): string | null {
  // Spreadsheets hand over numeric-looking cells (most barcodes) as numbers.
  if (typeof value === "number" && Number.isFinite(value)) return String(value);
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
}

function toNumber(value: unknown): number {
  const n = typeof value === "number" ? value : parseFloat(String(value));
  return Number.isFinite(n) ? n : NaN;
}

function toIntOrZero(value: unknown): number {
  const n = typeof value === "number" ? Math.trunc(value) : parseInt(String(value), 10);
  return Number.isFinite(n) ? n : 0;
}

function toCurrency(value: unknown): Currency {
  const upper = typeof value === "string" ? value.trim().toUpperCase() : "";
  return upper === "USD" || upper === "KHR" ? (upper as Currency) : "USD";
}

export interface BulkImportResult {
  imported: number;
  updated: number;
  skipped: number;
  errors: number;
}

interface ParsedImportRow {
  name: string;
  barcode: string | null;
  priceMinor: number;
  costPriceMinor: number;
  currency: Currency;
  stock: number;
}

/**
 * In production every query is a network round trip to Turso (tens of ms),
 * and Prisma cancels an interactive transaction after 5s. The old per-row
 * loop ran ~3 queries per row inside one transaction, so a 300-row batch
 * blew that limit and came back as a 500. Now a batch is: two lookups, two
 * bulk inserts for new products, and one small transaction per updated row.
 */
export async function bulkImportProducts(
  storeId: string,
  rows: BulkImportRow[],
  updateExisting: boolean
): Promise<BulkImportResult> {
  const result: BulkImportResult = { imported: 0, updated: 0, skipped: 0, errors: 0 };

  // Validate, and keep only the first row for a product that appears twice in
  // the batch (same barcode, or same name when there's no barcode).
  const parsed: ParsedImportRow[] = [];
  const seen = new Set<string>();
  for (const row of rows) {
    const name = toTrimmedStringOrNull(row.name);
    const price = toNumber(row.price);
    if (!name || !Number.isFinite(price) || price < 0) {
      result.skipped += 1;
      continue;
    }
    const barcode = toTrimmedStringOrNull(row.barcode);
    const key = productKey(name, barcode);
    if (seen.has(key)) {
      result.skipped += 1;
      continue;
    }
    seen.add(key);
    const currency = toCurrency(row.currency);
    const costPrice = toNumber(row.cost_price);
    parsed.push({
      name,
      barcode,
      priceMinor: toMinorUnits(price, currency),
      costPriceMinor: toMinorUnits(Number.isFinite(costPrice) ? costPrice : 0, currency),
      currency,
      stock: toIntOrZero(row.stock),
    });
  }

  // Barcode is unique across every product, deleted ones included, so look
  // those up unfiltered. Without a barcode, fall back to an exact name match
  // -- but only among this store's barcode-less products, since Product is
  // shared across stores and a generic name ("Water") may be unrelated elsewhere.
  const barcodes = parsed.flatMap((r) => (r.barcode ? [r.barcode] : []));
  const names = parsed.flatMap((r) => (r.barcode ? [] : [r.name]));
  const [barcodeHolders, nameMatches] = await Promise.all([
    barcodes.length ? prisma.product.findMany({ where: { barcode: { in: barcodes } } }) : [],
    names.length
      ? prisma.product.findMany({
          where: { name: { in: names }, barcode: null, isDeleted: false, storeProducts: { some: { storeId } } },
        })
      : [],
  ]);
  const byBarcode = new Map(barcodeHolders.map((p) => [p.barcode!, p]));
  const byName = new Map<string, (typeof nameMatches)[number]>();
  for (const p of nameMatches) if (!byName.has(p.name)) byName.set(p.name, p);

  const toCreate: ParsedImportRow[] = [];
  const toUpdate: Array<{ row: ParsedImportRow; productId: string }> = [];
  for (const row of parsed) {
    const existing = row.barcode ? byBarcode.get(row.barcode) : byName.get(row.name);
    if (!existing) {
      toCreate.push(row);
    } else if (existing.isDeleted) {
      // A deleted product still holds this barcode, so it can't be created.
      logger.warn({ storeId, barcode: row.barcode }, "bulkImportProducts barcode held by a deleted product");
      result.errors += 1;
    } else if (updateExisting) {
      toUpdate.push({ row, productId: existing.id });
    } else {
      // Already in the catalog and not updating: creating would duplicate it.
      result.skipped += 1;
    }
  }

  if (toCreate.length) {
    try {
      await prisma.$transaction(async (tx) => {
        const created = await tx.product.createManyAndReturn({
          data: toCreate.map((r) => ({
            name: r.name,
            barcode: r.barcode,
            defaultPriceMinor: r.priceMinor,
            currency: r.currency,
          })),
          select: { id: true, name: true, barcode: true },
        });
        const idByKey = new Map(created.map((p) => [productKey(p.name, p.barcode), p.id]));
        await tx.storeProduct.createMany({
          data: toCreate.map((r) => ({
            storeId,
            productId: idByKey.get(productKey(r.name, r.barcode))!,
            stock: r.stock,
            costPriceMinor: r.costPriceMinor,
            currency: r.currency,
          })),
        });
      });
      result.imported += toCreate.length;
    } catch (err) {
      logger.error({ err, storeId }, "bulkImportProducts create failed");
      result.errors += toCreate.length;
    }
  }

  for (const { row, productId } of toUpdate) {
    try {
      await prisma.$transaction([
        prisma.product.update({
          where: { id: productId },
          data: { name: row.name, defaultPriceMinor: row.priceMinor, currency: row.currency },
        }),
        prisma.storeProduct.upsert({
          where: { storeId_productId: { storeId, productId } },
          create: { storeId, productId, stock: row.stock, costPriceMinor: row.costPriceMinor, currency: row.currency },
          update: { stock: row.stock, costPriceMinor: row.costPriceMinor, currency: row.currency },
        }),
      ]);
      result.updated += 1;
    } catch (err) {
      logger.error({ err, storeId, productId }, "bulkImportProducts update failed");
      result.errors += 1;
    }
  }

  return result;
}

function productKey(name: string, barcode: string | null): string {
  return barcode ? `barcode:${barcode}` : `name:${name}`;
}
