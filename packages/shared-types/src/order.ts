import type { Currency } from "./product";

export type PaymentMethod = "CASH" | "KHQR" | "CARD";
export type OrderStatus = "COMPLETED" | "VOIDED";

export interface OrderItem {
  productId: string;
  quantity: number;
  priceAtSale: number;
  currency: Currency;
}

export interface Order {
  id: string;
  storeId: string;
  terminalId: string;
  /** Client-generated UUID, set at creation time on the POS terminal — the sync idempotency key for this order. */
  clientOrderUuid: string;
  customerId: string | null;
  totalAmount: number;
  currency: Currency;
  paymentMethod: PaymentMethod;
  bankName: string | null;
  amountPaidUsd: number;
  amountPaidKhr: number;
  changeGivenKhr: number;
  status: OrderStatus;
  items: OrderItem[];
  /** Local terminal clock at checkout time. */
  createdAt: string;
  /** Set by the backend when the sync event that created this order was applied. */
  syncedAt: string | null;
}
