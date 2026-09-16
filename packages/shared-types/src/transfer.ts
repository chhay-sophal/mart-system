export type StockTransferStatus = "REQUESTED" | "COMPLETED" | "CANCELLED";

export interface StockTransferItem {
  id: string;
  productId: string;
  productName: string;
  quantity: number;
}

export interface StockTransfer {
  id: string;
  fromStoreId: string;
  fromStoreName: string;
  toStoreId: string;
  toStoreName: string;
  status: StockTransferStatus;
  requestedBy: string;
  createdAt: string;
  completedAt: string | null;
  items: StockTransferItem[];
}
