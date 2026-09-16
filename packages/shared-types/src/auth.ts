import type { UserRole } from "./store";

/** Back-office (IMS) login. */
export interface LoginRequest {
  email: string;
  password: string;
}

export interface LoginResponse {
  accessToken: string;
  refreshToken: string;
}

/** Cashier PIN entry on a paired POS terminal — the terminal itself already holds a device credential. */
export interface PinLoginRequest {
  terminalId: string;
  storeId: string;
  pin: string;
}

export interface PinLoginResponse {
  sessionToken: string;
  userId: string;
  role: UserRole;
}

export interface AuthUser {
  id: string;
  email: string;
  name: string;
  isSuperAdmin: boolean;
}
