import type { NextFunction, Request, Response } from "express";
import type { UserRole } from "@mart-system/shared-types";
import { prisma } from "../prisma";
import { forbidden, unauthorized } from "../lib/httpError";

function resolveStoreId(req: Request): string | undefined {
  return (req.params.storeId as string | undefined) ?? (req.body as { storeId?: string } | undefined)?.storeId;
}

/**
 * Gates a route to callers holding one of `allowedRoles` at the store named in
 * `:storeId`/body.storeId. Works for either an IMS access-token user (looked up
 * against UserStoreRole, since one account can hold different roles at different
 * stores) or a cashier session (role/storeId already fixed at PIN-login time).
 */
export function requireRole(allowedRoles: UserRole[]) {
  return async (req: Request, _res: Response, next: NextFunction) => {
    const storeId = resolveStoreId(req);
    if (!storeId) return next(forbidden("storeId is required"));

    if (req.session) {
      if (req.session.storeId !== storeId || !allowedRoles.includes(req.session.role)) {
        return next(forbidden("Insufficient role for this store"));
      }
      return next();
    }

    if (req.user) {
      if (req.user.isSuperAdmin) return next();

      const role = await prisma.userStoreRole.findUnique({
        where: { userId_storeId: { userId: req.user.id, storeId } },
      });

      if (!role || !role.isActive || !allowedRoles.includes(role.role)) {
        return next(forbidden("Insufficient role for this store"));
      }
      return next();
    }

    return next(unauthorized("Authentication required"));
  };
}
