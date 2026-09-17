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

export async function bulkImportProducts(
  storeId: string,
  rows: BulkImportRow[],
  updateExisting: boolean
): Promise<BulkImportResult> {
  const result: BulkImportResult = { imported: 0, updated: 0, skipped: 0, errors: 0 };

  await prisma.$transaction(async (tx) => {
    for (const row of rows) {
      const name = toTrimmedStringOrNull(row.name);
      const price = toNumber(row.price);

      if (!name || !Number.isFinite(price) || price < 0) {
        result.skipped += 1;
        continue;
      }

      const barcode = toTrimmedStringOrNull(row.barcode);
      const costPrice = Number.isFinite(toNumber(row.cost_price)) ? toNumber(row.cost_price) : 0;
      const currency = toCurrency(row.currency);
      const stock = toIntOrZero(row.stock);

      try {
        const existing = barcode
          ? await tx.product.findFirst({ where: { barcode, isDeleted: false } })
          : null;

        if (existing && updateExisting) {
          await tx.product.update({
            where: { id: existing.id },
            data: { name, defaultPriceMinor: toMinorUnits(price, currency), currency },
          });
          await tx.storeProduct.upsert({
            where: { storeId_productId: { storeId, productId: existing.id } },
            create: { storeId, productId: existing.id, stock, costPriceMinor: toMinorUnits(costPrice, currency), currency },
            update: { stock, costPriceMinor: toMinorUnits(costPrice, currency), currency },
          });
          result.updated += 1;
          continue;
        }

        const product = await tx.product.create({
          data: { name, barcode, defaultPriceMinor: toMinorUnits(price, currency), currency },
        });
        await tx.storeProduct.create({
          data: { storeId, productId: product.id, stock, costPriceMinor: toMinorUnits(costPrice, currency), currency },
        });
        result.imported += 1;
      } catch (err) {
        logger.error({ err, storeId }, "bulkImportProducts row failed");
        result.errors += 1;
      }
    }
  });

  return result;
}
