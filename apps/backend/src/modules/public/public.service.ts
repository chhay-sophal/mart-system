import type { Prisma } from "@prisma/client";
import type {
  OpeningHours,
  PublicProduct,
  PublicProductAvailability,
  PublicStore,
  StockLevel,
} from "@mart-system/shared-types";
import { prisma } from "../../prisma";
import { notFound } from "../../lib/httpError";
import { fromMinorUnits } from "../../lib/money";

type StoreProductWithProduct = Prisma.StoreProductGetPayload<{ include: { product: true } }>;

// Explicit select, not the whole row — keeps anything added to Store later
// (credentials, internal flags) from leaking onto a public endpoint by default.
const PUBLIC_STORE_SELECT = {
  id: true,
  name: true,
  code: true,
  address: true,
  phone: true,
  timezone: true,
  openingHours: true,
  latitude: true,
  longitude: true,
} as const;

type PublicStoreRow = Prisma.StoreGetPayload<{ select: typeof PUBLIC_STORE_SELECT }>;

// openingHours is stored as untyped JSON; its shape is enforced on write
// (stores.schema.ts's openingHoursSchema), so it's safe to type it here.
function toPublicStore(row: PublicStoreRow, khqrStoreIds: Set<string>): PublicStore {
  return {
    ...row,
    openingHours: (row.openingHours as OpeningHours | null) ?? null,
    khqrAvailable: khqrStoreIds.has(row.id),
  };
}

/** Same rule as onlineOrders' isKhqrAvailable, batched: a Bakong account id and a registered email. */
async function storesWithKhqr(storeIds: string[]): Promise<Set<string>> {
  const [accounts, credentials] = await Promise.all([
    prisma.storeSetting.findMany({ where: { storeId: { in: storeIds }, key: "bakong_account_id" } }),
    prisma.bakongCredential.findMany({ where: { storeId: { in: storeIds }, registeredEmail: { not: null } } }),
  ]);
  const withEmail = new Set(credentials.map((c) => c.storeId));
  return new Set(accounts.filter((a) => a.value.trim() && withEmail.has(a.storeId)).map((a) => a.storeId));
}

export function toStockLevel(stock: number, lowStockThreshold: number): StockLevel {
  if (stock <= 0) return "OUT_OF_STOCK";
  if (stock <= lowStockThreshold) return "LOW_STOCK";
  return "IN_STOCK";
}

function toPublicProduct(row: StoreProductWithProduct): PublicProduct {
  const hasOverride = row.priceOverrideMinor !== null;
  const currency = hasOverride ? row.currency : row.product.currency;
  return {
    id: row.product.id,
    name: row.product.name,
    category: row.product.category,
    price: fromMinorUnits(hasOverride ? row.priceOverrideMinor : row.product.defaultPriceMinor, currency),
    currency,
    stockLevel: toStockLevel(row.stock, row.lowStockThreshold),
  };
}

export async function listPublicStores(): Promise<PublicStore[]> {
  const rows = await prisma.store.findMany({
    where: { isActive: true },
    select: PUBLIC_STORE_SELECT,
    orderBy: { name: "asc" },
  });
  const khqr = await storesWithKhqr(rows.map((r) => r.id));
  return rows.map((row) => toPublicStore(row, khqr));
}

export async function getPublicStoreOrThrow(storeId: string): Promise<PublicStore> {
  const store = await prisma.store.findFirst({
    where: { id: storeId, isActive: true },
    select: PUBLIC_STORE_SELECT,
  });
  if (!store) throw notFound("Store not found");
  return toPublicStore(store, await storesWithKhqr([store.id]));
}

export async function listPublicProducts(storeId: string, filter: { category?: string }): Promise<PublicProduct[]> {
  await getPublicStoreOrThrow(storeId);
  const rows = await prisma.storeProduct.findMany({
    where: {
      storeId,
      product: { isDeleted: false, ...(filter.category ? { category: filter.category } : {}) },
    },
    include: { product: true },
    orderBy: { product: { name: "asc" } },
  });
  return rows.map(toPublicProduct);
}

export async function getPublicProduct(storeId: string, productId: string): Promise<PublicProduct> {
  await getPublicStoreOrThrow(storeId);
  const row = await prisma.storeProduct.findUnique({
    where: { storeId_productId: { storeId, productId } },
    include: { product: true },
  });
  if (!row || row.product.isDeleted) throw notFound("Product not found");
  return toPublicProduct(row);
}

/** Stock level at every active branch that carries the product — the product page's "availability by branch". */
export async function getPublicProductAvailability(productId: string): Promise<PublicProductAvailability[]> {
  const rows = await prisma.storeProduct.findMany({
    where: { productId, product: { isDeleted: false }, store: { isActive: true } },
    include: { store: { select: { id: true, name: true } } },
    orderBy: { store: { name: "asc" } },
  });
  if (rows.length === 0) throw notFound("Product not found");
  return rows.map((row) => ({
    storeId: row.store.id,
    storeName: row.store.name,
    stockLevel: toStockLevel(row.stock, row.lowStockThreshold),
  }));
}
