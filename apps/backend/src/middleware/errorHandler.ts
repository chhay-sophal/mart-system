import type { NextFunction, Request, Response } from "express";
import { Prisma } from "@prisma/client";
import { ZodError } from "zod";
import { HttpError } from "../lib/httpError";
import { logger } from "../lib/logger";

function isBodyParserError(err: unknown): err is { status: number; message: string } {
  if (typeof err !== "object" || err === null) return false;
  const { type, status } = err as { type?: unknown; status?: unknown };
  return (
    typeof type === "string" &&
    (type === "entity.too.large" || type === "entity.parse.failed") &&
    typeof status === "number"
  );
}

// eslint-disable-next-line @typescript-eslint/no-unused-vars
export function errorHandler(err: unknown, _req: Request, res: Response, _next: NextFunction) {
  if (err instanceof HttpError) {
    return res.status(err.status).json({ error: err.message });
  }

  if (err instanceof ZodError) {
    return res.status(400).json({ error: "Validation failed", details: err.flatten() });
  }

  if (err instanceof Prisma.PrismaClientKnownRequestError) {
    if (err.code === "P2002") {
      return res.status(409).json({ error: "A record with that value already exists" });
    }
    if (err.code === "P2025") {
      return res.status(404).json({ error: "Record not found" });
    }
  }

  // express.json() errors (body over the size limit, malformed JSON) carry
  // their own 4xx status; surface it instead of masking it as a 500.
  if (isBodyParserError(err)) {
    return res.status(err.status).json({ error: err.message });
  }

  logger.error({ err }, "Unhandled error");
  return res.status(500).json({ error: "Internal server error" });
}
