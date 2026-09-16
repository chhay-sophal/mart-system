import crypto from "node:crypto";
import jwt from "jsonwebtoken";
import type { UserRole } from "@mart-system/shared-types";
import { env } from "../env";

export type TokenType = "access" | "refresh" | "cashier-session";

export interface AccessTokenPayload {
  typ: "access";
  sub: string;
  email: string;
  isSuperAdmin: boolean;
}

export interface RefreshTokenPayload {
  typ: "refresh";
  sub: string;
  /** RefreshToken row id — lets verification find the matching persisted record. */
  jti: string;
}

export interface CashierSessionPayload {
  typ: "cashier-session";
  sub: string;
  storeId: string;
  terminalId: string;
  role: UserRole;
}

class TokenTypeMismatchError extends Error {
  constructor(expected: TokenType, actual: unknown) {
    super(`Expected a "${expected}" token, got "${String(actual)}"`);
    this.name = "TokenTypeMismatchError";
  }
}

function sign(payload: object, ttl: string) {
  return jwt.sign(payload, env.JWT_SECRET, { expiresIn: ttl as jwt.SignOptions["expiresIn"] });
}

function verify<T>(token: string, expectedType: TokenType): T {
  const decoded = jwt.verify(token, env.JWT_SECRET) as jwt.JwtPayload;
  if (decoded.typ !== expectedType) {
    throw new TokenTypeMismatchError(expectedType, decoded.typ);
  }
  return decoded as T;
}

export function signAccessToken(payload: Omit<AccessTokenPayload, "typ">) {
  return sign({ ...payload, typ: "access" satisfies AccessTokenPayload["typ"] }, env.ACCESS_TOKEN_TTL);
}

export function verifyAccessToken(token: string) {
  return verify<AccessTokenPayload>(token, "access");
}

export function signRefreshToken(payload: Omit<RefreshTokenPayload, "typ">) {
  return sign({ ...payload, typ: "refresh" satisfies RefreshTokenPayload["typ"] }, env.REFRESH_TOKEN_TTL);
}

export function verifyRefreshToken(token: string) {
  return verify<RefreshTokenPayload>(token, "refresh");
}

export function signCashierSessionToken(payload: Omit<CashierSessionPayload, "typ">) {
  return sign(
    { ...payload, typ: "cashier-session" satisfies CashierSessionPayload["typ"] },
    env.CASHIER_SESSION_TTL
  );
}

export function verifyCashierSessionToken(token: string) {
  return verify<CashierSessionPayload>(token, "cashier-session");
}

/** RefreshToken rows store this hash, never the raw token — lets us revoke/detect-reuse without keeping bearer secrets at rest. */
export function hashToken(rawToken: string) {
  return crypto.createHash("sha256").update(rawToken).digest("hex");
}
