import type { NextFunction, Request, Response } from "express";
import { Prisma } from "@prisma/client";
import { prisma } from "../prisma";
import { verifyDeviceSecret } from "../lib/hash";
import { unauthorized } from "../lib/httpError";
import { logger } from "../lib/logger";

const LAST_SEEN_THROTTLE_MS = 60_000;

export async function requireTerminal(req: Request, _res: Response, next: NextFunction) {
  const terminalId = req.header("x-terminal-id");
  const secret = req.header("x-terminal-secret");
  if (!terminalId || !secret) return next(unauthorized("Missing terminal credentials"));

  const terminal = await prisma.terminal.findUnique({ where: { id: terminalId } });
  if (!terminal || !terminal.isActive) return next(unauthorized("Unknown or inactive terminal"));

  const valid = await verifyDeviceSecret(secret, terminal.deviceCredentialHash);
  if (!valid) return next(unauthorized("Invalid terminal credentials"));

  req.terminal = { id: terminal.id, storeId: terminal.storeId };

  const isStale = !terminal.lastSeenAt || Date.now() - terminal.lastSeenAt.getTime() > LAST_SEEN_THROTTLE_MS;
  if (isStale) {
    prisma.terminal.update({ where: { id: terminal.id }, data: { lastSeenAt: new Date() } }).catch((err: unknown) => {
      // P2025 (row gone by the time this fire-and-forget write lands) is a benign
      // race, not a bug — e.g. the terminal was deactivated/removed mid-request.
      if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === "P2025") return;
      logger.error({ err, terminalId: terminal.id }, "Failed to update terminal lastSeenAt");
    });
  }

  next();
}
