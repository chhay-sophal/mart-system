export type Currency = "USD" | "KHR";

export interface Product {
  id: string;
  barcode: string | null;
  name: string;
  category: string | null;
  defaultPrice: number;
  currency: Currency;
  isDeleted: boolean;
  createdAt: string;
  updatedAt: string;
}

/** Per-store stock + pricing override — the row POS/IMS actually read and edit. */
export interface StoreProduct {
  id: string;
  storeId: string;
  productId: string;
  stock: number;
  priceOverride: number | null;
  costPrice: number;
  currency: Currency;
  lowStockThreshold: number;
}

export type StockMovementReason =
  | "SALE"
  | "VOID"
  | "RECEIVE_PURCHASE"
  | "TRANSFER_IN"
  | "TRANSFER_OUT"
  | "ADJUSTMENT"
  | "STOCKTAKE";

/** Append-only ledger entry. StoreProduct.stock is a derived cache kept in sync with these. */
export interface StockMovement {
  id: string;
  storeId: string;
  productId: string;
  terminalId: string | null;
  delta: number;
  reason: StockMovementReason;
  refType: string | null;
  refId: string | null;
  sourceEventId: string | null;
  createdAt: string;
}
