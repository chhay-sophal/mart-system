import type { OrderItem, PaymentMethod } from "./order";
import type { Currency } from "./product";

export type SyncEventType = "SALE_COMPLETED" | "SALE_VOIDED";

export interface SaleCompletedPayload {
  clientOrderUuid: string;
  items: OrderItem[];
  paymentMethod: PaymentMethod;
  totalAmount: number;
  /** Currency of totalAmount: the store's main currency at the time of sale. Defaults to USD. */
  currency?: Currency;
  amountPaidUsd: number;
  amountPaidKhr: number;
  changeGivenKhr: number;
  cashierUserId?: string;
  /** Which bank's static QR the customer paid to (STATIC_QR sales). */
  bankName?: string;
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
    /** Currency of the price the terminal sells at: priceOverride's if set, else defaultPrice's. */
    currency: Currency;
    stock: number;
    isDeleted: boolean;
  }>;
  /** Cached locally so a POS terminal can verify a cashier PIN fully offline. */
  staffRoster: Array<{
    userId: string;
    name: string;
    role: string;
    pinHash: string;
    isActive: boolean;
  }>;
  /** Managed in IMS; sent in full every pull. null = not set, keep the local value. Shop details are per register (issue #5). */
  storeSettings: {
    mainCurrency: string | null;
    locale: string | null;
    exchangeRate: string | null;
  };
}
