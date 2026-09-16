import type { Currency } from "./product";

export type KhqrStatus = "PENDING" | "PAID" | "EXPIRED";

export interface KhqrGenerateRequest {
  storeId: string;
  orderId: string;
  amount: number;
  currency: Currency;
}

export interface KhqrGenerateResponse {
  qrString: string;
  md5Hash: string;
  amount: number;
  currency: Currency;
}

export interface KhqrStatusResponse {
  status: KhqrStatus;
}
