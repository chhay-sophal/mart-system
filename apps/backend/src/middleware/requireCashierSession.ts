import type { NextFunction, Request, Response } from "express";
import { verifyCashierSessionToken } from "../lib/jwt";
import { unauthorized } from "../lib/httpError";

export function requireCashierSession(req: Request, _res: Response, next: NextFunction) {
  const header = req.header("authorization");
  const token = header?.startsWith("Bearer ") ? header.slice("Bearer ".length) : undefined;
  if (!token) return next(unauthorized("Missing session token"));

  try {
    const payload = verifyCashierSessionToken(token);
    req.session = {
      userId: payload.sub,
      storeId: payload.storeId,
      terminalId: payload.terminalId,
      role: payload.role,
    };
    next();
  } catch {
    next(unauthorized("Invalid or expired session token"));
  }
}
