import { Router } from "express";
import { asyncHandler } from "../../middleware/asyncHandler";
import { requireAccessToken } from "../../middleware/requireAccessToken";
import { requireRole } from "../../middleware/requireRole";
import { createTerminalSchema, updateTerminalSchema } from "./terminals.schema";
import { listTerminals, pairTerminal, rotateTerminalSecret, updateTerminal } from "./terminals.service";

export const terminalsRouter: Router = Router();

terminalsRouter.get(
  "/stores/:storeId/terminals",
  requireAccessToken,
  requireRole(["ADMIN"]),
  asyncHandler(async (req, res) => {
    res.json(await listTerminals(req.params.storeId!));
  })
);

terminalsRouter.post(
  "/stores/:storeId/terminals",
  requireAccessToken,
  requireRole(["ADMIN"]),
  asyncHandler(async (req, res) => {
    const input = createTerminalSchema.parse(req.body);
    res.status(201).json(await pairTerminal(req.params.storeId!, input));
  })
);

terminalsRouter.patch(
  "/stores/:storeId/terminals/:terminalId",
  requireAccessToken,
  requireRole(["ADMIN"]),
  asyncHandler(async (req, res) => {
    const input = updateTerminalSchema.parse(req.body);
    res.json(await updateTerminal(req.params.storeId!, req.params.terminalId!, input));
  })
);

terminalsRouter.post(
  "/stores/:storeId/terminals/:terminalId/rotate-secret",
  requireAccessToken,
  requireRole(["ADMIN"]),
  asyncHandler(async (req, res) => {
    res.json(await rotateTerminalSecret(req.params.storeId!, req.params.terminalId!));
  })
);
