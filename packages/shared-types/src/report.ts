import type { StockMovement } from "./product";

/** A StoreProduct row whose stock has gone negative, with recent ledger context for a manager to reconcile. */
export interface NegativeStockRow {
  storeId: string;
  storeName: string;
  productId: string;
  productName: string;
  barcode: string | null;
  stock: number;
  recentMovements: StockMovement[];
}
