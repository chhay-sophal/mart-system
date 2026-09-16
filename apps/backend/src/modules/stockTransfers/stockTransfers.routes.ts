import { Router } from "express";
import { asyncHandler } from "../../middleware/asyncHandler";
import { requireAccessToken } from "../../middleware/requireAccessToken";
import { createTransferSchema, listTransfersQuerySchema } from "./stockTransfers.schema";
import { cancelTransfer, completeTransfer, createTransfer, listTransfers } from "./stockTransfers.service";

export const stockTransfersRouter: Router = Router();

// Top-level, not nested under /stores/:storeId — a transfer inherently spans
// two stores, so requireRole (which only resolves one storeId from
// params/body) doesn't fit; role checks against both sides happen inside the
// service instead.

stockTransfersRouter.get(
  "/stock-transfers",
  requireAccessToken,
  asyncHandler(async (req, res) => {
    const { storeId } = listTransfersQuerySchema.parse(req.query);
    res.json(await listTransfers(req.user!, storeId));
  })
);

stockTransfersRouter.post(
  "/stock-transfers",
  requireAccessToken,
  asyncHandler(async (req, res) => {
    const input = createTransferSchema.parse(req.body);
    res.status(201).json(await createTransfer(req.user!, input));
  })
);

stockTransfersRouter.post(
  "/stock-transfers/:id/complete",
  requireAccessToken,
  asyncHandler(async (req, res) => {
    res.json(await completeTransfer(req.user!, req.params.id!));
  })
);

stockTransfersRouter.post(
  "/stock-transfers/:id/cancel",
  requireAccessToken,
  asyncHandler(async (req, res) => {
    res.json(await cancelTransfer(req.user!, req.params.id!));
  })
);
