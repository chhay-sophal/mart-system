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

export interface DailySummaryPaymentBreakdown {
  paymentMethod: string;
  count: number;
  total: number;
}

export interface DailySummaryTopProduct {
  productId: string;
  name: string;
  totalQty: number;
  revenue: number;
}

export interface DailySummaryByStore {
  storeId: string;
  storeName: string;
  /** Till sales plus collected online orders. */
  orderCount: number;
  /** How many of orderCount were online orders collected in the period. */
  onlineOrderCount: number;
  totalRevenue: number;
  avgOrder: number;
  grossProfit: number;
  byMethod: DailySummaryPaymentBreakdown[];
  topProducts: DailySummaryTopProduct[];
}

export interface DailySummaryReport {
  byStore: DailySummaryByStore[];
  combined: {
    orderCount: number;
    onlineOrderCount: number;
    totalRevenue: number;
    avgOrder: number;
    grossProfit: number;
  };
}
