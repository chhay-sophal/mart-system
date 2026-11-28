import { Router } from "express";
import { asyncHandler } from "../../middleware/asyncHandler";
import { requireAccessToken } from "../../middleware/requireAccessToken";
import { requireRole } from "../../middleware/requireRole";
import { requireTerminal } from "../../middleware/requireTerminal";
import { generateKhqrSchema } from "./payments.schema";
import { checkKhqrStatus, generateKhqr, getBakongCredentialView } from "./payments.service";

export const paymentsRouter: Router = Router();

// Status only (configured or not, masked email, token held): the registered
// email itself lives in the server's BAKONG_REGISTERED_EMAIL setting and is
// never returned or set through the API.
paymentsRouter.get(
  "/stores/:storeId/bakong-credential",
  requireAccessToken,
  requireRole(["ADMIN"]),
  asyncHandler(async (req, res) => {
    res.json(await getBakongCredentialView(req.params.storeId!));
  })
);

paymentsRouter.post(
  "/payments/khqr",
  requireTerminal,
  asyncHandler(async (req, res) => {
    const input = generateKhqrSchema.parse(req.body);
    res.json(await generateKhqr(req.terminal!, input));
  })
);

paymentsRouter.get(
  "/payments/khqr/:md5Hash/status",
  requireTerminal,
  asyncHandler(async (req, res) => {
    // ?manual=1: the cashier pressed Check payment, so Bakong may be asked sooner.
    const status = await checkKhqrStatus(req.terminal!.storeId, req.params.md5Hash!, { manual: req.query.manual === "1" });
    res.json({ status });
  })
);
