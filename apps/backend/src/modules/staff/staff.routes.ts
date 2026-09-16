import { Router } from "express";
import { asyncHandler } from "../../middleware/asyncHandler";
import { requireAccessToken } from "../../middleware/requireAccessToken";
import { requireRole } from "../../middleware/requireRole";
import { createStaffSchema, resetPinSchema, updateStaffSchema } from "./staff.schema";
import { createStaff, deactivateStaff, listStaff, resetStaffPin, updateStaff } from "./staff.service";

export const staffRouter: Router = Router();

staffRouter.get(
  "/stores/:storeId/staff",
  requireAccessToken,
  requireRole(["ADMIN"]),
  asyncHandler(async (req, res) => {
    res.json(await listStaff(req.params.storeId!));
  })
);

staffRouter.post(
  "/stores/:storeId/staff",
  requireAccessToken,
  requireRole(["ADMIN"]),
  asyncHandler(async (req, res) => {
    const input = createStaffSchema.parse(req.body);
    res.status(201).json(await createStaff(req.params.storeId!, input));
  })
);

staffRouter.patch(
  "/stores/:storeId/staff/:userId",
  requireAccessToken,
  requireRole(["ADMIN"]),
  asyncHandler(async (req, res) => {
    const input = updateStaffSchema.parse(req.body);
    res.json(await updateStaff(req.params.storeId!, req.params.userId!, input));
  })
);

staffRouter.post(
  "/stores/:storeId/staff/:userId/reset-pin",
  requireAccessToken,
  requireRole(["ADMIN"]),
  asyncHandler(async (req, res) => {
    const { pin } = resetPinSchema.parse(req.body);
    res.json(await resetStaffPin(req.params.storeId!, req.params.userId!, pin));
  })
);

staffRouter.delete(
  "/stores/:storeId/staff/:userId",
  requireAccessToken,
  requireRole(["ADMIN"]),
  asyncHandler(async (req, res) => {
    await deactivateStaff(req.params.storeId!, req.params.userId!);
    res.status(204).end();
  })
);
