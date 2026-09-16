import { Router } from "express";
import { asyncHandler } from "../../middleware/asyncHandler";
import { requireAccessToken } from "../../middleware/requireAccessToken";
import { requireRole } from "../../middleware/requireRole";
import { bulkImportSchema, createProductSchema, updateProductSchema } from "./products.schema";
import {
  bulkImportProducts,
  createProduct,
  deleteProduct,
  getProduct,
  listLowStock,
  listProducts,
  updateProduct,
} from "./products.service";

export const productsRouter: Router = Router();

const ANY_ROLE = ["CASHIER", "INVENTORY", "ADMIN"] as const;
const MANAGE_ROLES = ["INVENTORY", "ADMIN"] as const;

productsRouter.get(
  "/stores/:storeId/products",
  requireAccessToken,
  requireRole([...ANY_ROLE]),
  asyncHandler(async (req, res) => {
    res.json(await listProducts(req.params.storeId!));
  })
);

// Must be registered before "/:productId" or "low-stock" would be parsed as a productId.
productsRouter.get(
  "/stores/:storeId/products/low-stock",
  requireAccessToken,
  requireRole([...ANY_ROLE]),
  asyncHandler(async (req, res) => {
    res.json(await listLowStock(req.params.storeId!));
  })
);

productsRouter.post(
  "/stores/:storeId/products/bulk-import",
  requireAccessToken,
  requireRole([...MANAGE_ROLES]),
  asyncHandler(async (req, res) => {
    const { products, updateExisting } = bulkImportSchema.parse(req.body);
    res.json(await bulkImportProducts(req.params.storeId!, products, updateExisting));
  })
);

productsRouter.get(
  "/stores/:storeId/products/:productId",
  requireAccessToken,
  requireRole([...ANY_ROLE]),
  asyncHandler(async (req, res) => {
    res.json(await getProduct(req.params.storeId!, req.params.productId!));
  })
);

productsRouter.post(
  "/stores/:storeId/products",
  requireAccessToken,
  requireRole([...MANAGE_ROLES]),
  asyncHandler(async (req, res) => {
    const input = createProductSchema.parse(req.body);
    res.status(201).json(await createProduct(req.params.storeId!, input));
  })
);

productsRouter.put(
  "/stores/:storeId/products/:productId",
  requireAccessToken,
  requireRole([...MANAGE_ROLES]),
  asyncHandler(async (req, res) => {
    const input = updateProductSchema.parse(req.body);
    res.json(await updateProduct(req.params.storeId!, req.params.productId!, input));
  })
);

productsRouter.delete(
  "/stores/:storeId/products/:productId",
  requireAccessToken,
  requireRole([...MANAGE_ROLES]),
  asyncHandler(async (req, res) => {
    await deleteProduct(req.params.storeId!, req.params.productId!);
    res.status(204).end();
  })
);
