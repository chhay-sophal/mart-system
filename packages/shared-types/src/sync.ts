import type { OrderItem, PaymentMethod } from "./order";

export type SyncEventType = "SALE_COMPLETED" | "SALE_VOIDED";

export interface SaleCompletedPayload {
  clientOrderUuid: string;
  items: OrderItem[];
  paymentMethod: PaymentMethod;
  totalAmount: number;
  amountPaidUsd: number;
  amountPaidKhr: number;
  changeGivenKhr: number;
  khqrMd5Hash?: string;
  khqrQrString?: string;
  khqrBankName?: string;
}

export interface SaleVoidedPayload {
  clientOrderUuid: string;
}

/** One row from the POS-local outbox table. Never carries catalog/price changes — those only flow backend -> POS. */
export interface OutboxEvent {
  eventId: string;
  terminalId: string;
  sequenceNo: number;
  eventType: SyncEventType;
  payload: SaleCompletedPayload | SaleVoidedPayload;
  createdAt: string;
}

export interface SyncPushRequest {
  terminalId: string;
  storeId: string;
  events: OutboxEvent[];
}

export type SyncPushEventResult =
  | { eventId: string; status: "applied"; orderId: string }
  | { eventId: string; status: "duplicate"; orderId: string }
  | { eventId: string; status: "error"; error: string };

export interface SyncPushResponse {
  results: SyncPushEventResult[];
}

export interface SyncPullRequest {
  storeId: string;
  /** Cursor returned by the previous pull; omit for a first-ever sync. */
  since?: string;
}

export interface SyncPullResponse {
  cursor: string;
  productUpserts: Array<{
    productId: string;
    name: string;
    barcode: string | null;
    priceOverride: number | null;
    defaultPrice: number;
    stock: number;
    isDeleted: boolean;
  }>;
}
