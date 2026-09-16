// bakong-khqr ships no types (plain CommonJS, `main: src/index.js`) — this is a
// minimal ambient declaration covering just what this backend actually calls.
declare module "bakong-khqr" {
  export interface KhqrOptionalData {
    currency: number;
    amount: number;
    expirationTimestamp?: number;
    mobileNumber?: string;
  }

  export class IndividualInfo {
    constructor(bakongAccountId: string, merchantName: string, merchantCity: string, optionalData: KhqrOptionalData);
  }

  export interface KhqrGenerateResult {
    data?: { qr: string; md5: string };
    status?: { code: number; message?: string };
  }

  export class BakongKHQR {
    generateIndividual(individualInfo: IndividualInfo): KhqrGenerateResult;
  }

  export const khqrData: {
    currency: { usd: number; khr: number };
  };
}
