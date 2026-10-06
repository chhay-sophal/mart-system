import { Router } from "express";
import { asyncHandler } from "../../middleware/asyncHandler";
import { requireAccessToken } from "../../middleware/requireAccessToken";
import { requireRole } from "../../middleware/requireRole";
import { createSupplierSchema, updateSupplierSchema } from "./suppliers.schema";
import { createSupplier, deleteSupplier, getSupplier, listSuppliers, updateSupplier } from "./suppliers.service";

export const suppliersRouter: Router = Router();

const ANY_ROLE = ["CASHIER", "INVENTORY", "ADMIN"] as const;
const MANAGE_ROLES = ["INVENTORY", "ADMIN"] as const;

// Suppliers are global (like Product), not store-owned data -- nested under
// /stores/:storeId the same way Products are purely so every request goes
// through the same per-store role check as the rest of the app.
suppliersRouter.get(
  "/stores/:storeId/suppliers",
  requireAccessToken,
  requireRole([...ANY_ROLE]),
  asyncHandler(async (req, res) => {
    res.json(await listSuppliers(req.query.includeDeleted === "true"));
  })
);

suppliersRouter.get(
  "/stores/:storeId/suppliers/:supplierId",
  requireAccessToken,
  requireRole([...ANY_ROLE]),
  asyncHandler(async (req, res) => {
    res.json(await getSupplier(req.params.supplierId!));
  })
);

suppliersRouter.post(
  "/stores/:storeId/suppliers",
  requireAccessToken,
  requireRole([...MANAGE_ROLES]),
  asyncHandler(async (req, res) => {
    const input = createSupplierSchema.parse(req.body);
    res.status(201).json(await createSupplier(input));
  })
);

suppliersRouter.put(
  "/stores/:storeId/suppliers/:supplierId",
  requireAccessToken,
  requireRole([...MANAGE_ROLES]),
  asyncHandler(async (req, res) => {
    const input = updateSupplierSchema.parse(req.body);
    res.json(await updateSupplier(req.params.supplierId!, input));
  })
);

suppliersRouter.delete(
  "/stores/:storeId/suppliers/:supplierId",
  requireAccessToken,
  requireRole([...MANAGE_ROLES]),
  asyncHandler(async (req, res) => {
    await deleteSupplier(req.params.supplierId!);
    res.status(204).end();
  })
);
