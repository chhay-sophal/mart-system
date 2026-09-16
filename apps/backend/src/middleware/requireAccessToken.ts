import type { NextFunction, Request, Response } from "express";
import { verifyAccessToken } from "../lib/jwt";
import { unauthorized } from "../lib/httpError";

export function requireAccessToken(req: Request, _res: Response, next: NextFunction) {
  const header = req.header("authorization");
  const token = header?.startsWith("Bearer ") ? header.slice("Bearer ".length) : undefined;
  if (!token) return next(unauthorized("Missing access token"));

  try {
    const payload = verifyAccessToken(token);
    req.user = { id: payload.sub, email: payload.email, isSuperAdmin: payload.isSuperAdmin };
    next();
  } catch {
    next(unauthorized("Invalid or expired access token"));
  }
}
