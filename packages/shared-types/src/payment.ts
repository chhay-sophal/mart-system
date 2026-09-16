import type { Currency } from "./product";

export type KhqrStatus = "PENDING" | "PAID" | "EXPIRED";

/** storeId comes from the caller's terminal device credential, not the body — there's no Order yet at generation time (payment hasn't cleared). */
export interface KhqrGenerateRequest {
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
