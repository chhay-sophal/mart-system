import type { Currency } from "./product";

/**
 * Wire contracts for the unauthenticated storefront API (/api/public/*).
 * Deliberately narrower than the staff-facing Store/StoreProduct shapes — no
 * cost prices, thresholds, or exact stock counts ever leave the backend here.
 */

export interface PublicStore {
  id: string;
  name: string;
  code: string;
  address: string | null;
  phone: string | null;
  timezone: string;
}

/** Coarse availability instead of a raw count — enough for a shopper, nothing a competitor can inventory. */
export type StockLevel = "IN_STOCK" | "LOW_STOCK" | "OUT_OF_STOCK";

export interface PublicProduct {
  id: string;
  name: string;
  category: string | null;
  /** The branch's effective price: its override if set, otherwise the catalog default. */
  price: number;
  currency: Currency;
  stockLevel: StockLevel;
}

export interface PublicProductAvailability {
  storeId: string;
  storeName: string;
  stockLevel: StockLevel;
}
