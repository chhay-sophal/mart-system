import { Router } from "express";
import { asyncHandler } from "../../middleware/asyncHandler";
import { requireAccessToken } from "../../middleware/requireAccessToken";
import { requireRole } from "../../middleware/requireRole";
import { createCategorySchema, updateCategorySchema } from "./categories.schema";
import {
  createCategory,
  deleteCategory,
  getCategory,
  listCategories,
  restoreCategory,
  updateCategory,
} from "./categories.service";

export const categoriesRouter: Router = Router();

const ANY_ROLE = ["CASHIER", "INVENTORY", "ADMIN"] as const;
const MANAGE_ROLES = ["INVENTORY", "ADMIN"] as const;

// Categories are global (like Product and Supplier), nested under
// /stores/:storeId purely so every request goes through the same per-store
// role check as the rest of the app.
categoriesRouter.get(
  "/stores/:storeId/categories",
  requireAccessToken,
  requireRole([...ANY_ROLE]),
  asyncHandler(async (req, res) => {
    res.json(await listCategories(req.query.includeDeleted === "true"));
  })
);

categoriesRouter.get(
  "/stores/:storeId/categories/:categoryId",
  requireAccessToken,
  requireRole([...ANY_ROLE]),
  asyncHandler(async (req, res) => {
    res.json(await getCategory(req.params.categoryId!));
  })
);

categoriesRouter.post(
  "/stores/:storeId/categories",
  requireAccessToken,
  requireRole([...MANAGE_ROLES]),
  asyncHandler(async (req, res) => {
    const input = createCategorySchema.parse(req.body);
    res.status(201).json(await createCategory(input));
  })
);

categoriesRouter.put(
  "/stores/:storeId/categories/:categoryId",
  requireAccessToken,
  requireRole([...MANAGE_ROLES]),
  asyncHandler(async (req, res) => {
    const input = updateCategorySchema.parse(req.body);
    res.json(await updateCategory(req.params.categoryId!, input));
  })
);

categoriesRouter.delete(
  "/stores/:storeId/categories/:categoryId",
  requireAccessToken,
  requireRole([...MANAGE_ROLES]),
  asyncHandler(async (req, res) => {
    await deleteCategory(req.params.categoryId!);
    res.status(204).end();
  })
);

categoriesRouter.post(
  "/stores/:storeId/categories/:categoryId/restore",
  requireAccessToken,
  requireRole([...MANAGE_ROLES]),
  asyncHandler(async (req, res) => {
    res.json(await restoreCategory(req.params.categoryId!));
  })
);
