import type { UserRole } from "@mart-system/shared-types";

declare global {
  namespace Express {
    interface Request {
      /** Set by requireAccessToken: the back-office (IMS) user making this request. */
      user?: {
        id: string;
        email: string;
        isSuperAdmin: boolean;
      };
      /** Set by requireTerminal: the paired POS terminal presenting a device credential. */
      terminal?: {
        id: string;
        storeId: string;
      };
      /** Set by requireCashierSession: the cashier shift session from PIN login. */
      session?: {
        userId: string;
        storeId: string;
        terminalId: string;
        role: UserRole;
      };
    }
  }
}

export {};
