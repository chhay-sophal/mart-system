import { Router } from "express";
import { asyncHandler } from "../../middleware/asyncHandler";
import { requireAccessToken } from "../../middleware/requireAccessToken";
import { requireRole } from "../../middleware/requireRole";
import { putSettingsSchema, updateStoreSchema } from "./stores.schema";
import { getStoreOrThrow, getStoreSettings, listStoresForUser, putStoreSettings, updateStore } from "./stores.service";

export const storesRouter: Router = Router();

const ANY_ROLE = ["CASHIER", "INVENTORY", "ADMIN"] as const;

storesRouter.get(
  "/",
  requireAccessToken,
  asyncHandler(async (req, res) => {
    const stores = await listStoresForUser(req.user!);
    res.json(stores);
  })
);

storesRouter.get(
  "/:storeId",
  requireAccessToken,
  requireRole([...ANY_ROLE]),
  asyncHandler(async (req, res) => {
    const store = await getStoreOrThrow(req.params.storeId!);
    res.json(store);
  })
);

storesRouter.patch(
  "/:storeId",
  requireAccessToken,
  requireRole(["ADMIN"]),
  asyncHandler(async (req, res) => {
    const input = updateStoreSchema.parse(req.body);
    const store = await updateStore(req.params.storeId!, input);
    res.json(store);
  })
);

storesRouter.get(
  "/:storeId/settings",
  requireAccessToken,
  requireRole([...ANY_ROLE]),
  asyncHandler(async (req, res) => {
    const settings = await getStoreSettings(req.params.storeId!);
    res.json({ settings });
  })
);

storesRouter.put(
  "/:storeId/settings",
  requireAccessToken,
  requireRole(["ADMIN"]),
  asyncHandler(async (req, res) => {
    const { settings } = putSettingsSchema.parse(req.body);
    const updated = await putStoreSettings(req.params.storeId!, settings);
    res.json({ settings: updated });
  })
);
