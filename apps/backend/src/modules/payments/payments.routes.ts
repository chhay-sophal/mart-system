import { Router } from "express";
import { asyncHandler } from "../../middleware/asyncHandler";
import { requireAccessToken } from "../../middleware/requireAccessToken";
import { requireRole } from "../../middleware/requireRole";
import { requireTerminal } from "../../middleware/requireTerminal";
import { bakongCredentialSchema, generateKhqrSchema } from "./payments.schema";
import {
  checkKhqrStatus,
  generateKhqr,
  getBakongCredentialView,
  setBakongRegisteredEmail,
} from "./payments.service";

export const paymentsRouter: Router = Router();

paymentsRouter.get(
  "/stores/:storeId/bakong-credential",
  requireAccessToken,
  requireRole(["ADMIN"]),
  asyncHandler(async (req, res) => {
    res.json(await getBakongCredentialView(req.params.storeId!));
  })
);

paymentsRouter.put(
  "/stores/:storeId/bakong-credential",
  requireAccessToken,
  requireRole(["ADMIN"]),
  asyncHandler(async (req, res) => {
    const { registeredEmail } = bakongCredentialSchema.parse(req.body);
    res.json(await setBakongRegisteredEmail(req.params.storeId!, registeredEmail));
  })
);

paymentsRouter.post(
  "/payments/khqr",
  requireTerminal,
  asyncHandler(async (req, res) => {
    const input = generateKhqrSchema.parse(req.body);
    res.json(await generateKhqr(req.terminal!.storeId, input));
  })
);

paymentsRouter.get(
  "/payments/khqr/:md5Hash/status",
  requireTerminal,
  asyncHandler(async (req, res) => {
    const status = await checkKhqrStatus(req.terminal!.storeId, req.params.md5Hash!);
    res.json({ status });
  })
);
