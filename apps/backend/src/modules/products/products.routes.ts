import { Router } from "express";
import { z } from "zod";
import { asyncHandler } from "../../middleware/asyncHandler";
import { requireAccessToken } from "../../middleware/requireAccessToken";
import { requireRole } from "../../middleware/requireRole";
import { adjustStockSchema, bulkDeleteSchema, bulkImportSchema, createProductSchema, updateProductSchema } from "./products.schema";
import {
  adjustStock,
  bulkDeleteProducts,
  bulkImportProducts,
  createProduct,
  deleteProduct,
  getProduct,
  listLowStock,
  listProducts,
  listProductsForUser,
  restoreProduct,
  updateProduct,
} from "./products.service";

export const productsRouter: Router = Router();

const ANY_ROLE = ["CASHIER", "INVENTORY", "ADMIN"] as const;
const MANAGE_ROLES = ["INVENTORY", "ADMIN"] as const;

const listAllQuerySchema = z.object({
  // Omitted = every store the user can see ("All stores").
  storeId: z.string().min(1).optional(),
  includeDeleted: z.coerce.boolean().optional(),
});

// IMS Products page's "All stores" view. No requireRole -- like reports and
// orders, a list can span several stores, so access is checked per store in
// the service (resolveAccessibleStoreIds).
productsRouter.get(
  "/products",
  requireAccessToken,
  asyncHandler(async (req, res) => {
    const { storeId, includeDeleted } = listAllQuerySchema.parse(req.query);
    res.json(await listProductsForUser(req.user!, { storeId, includeDeleted }));
  })
);

productsRouter.get(
  "/stores/:storeId/products",
  requireAccessToken,
  requireRole([...ANY_ROLE]),
  asyncHandler(async (req, res) => {
    res.json(await listProducts(req.params.storeId!, req.query.includeDeleted === "true"));
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

productsRouter.post(
  "/stores/:storeId/products/bulk-delete",
  requireAccessToken,
  requireRole([...MANAGE_ROLES]),
  asyncHandler(async (req, res) => {
    const { productIds } = bulkDeleteSchema.parse(req.body);
    res.json(await bulkDeleteProducts(req.params.storeId!, productIds));
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

productsRouter.post(
  "/stores/:storeId/products/:productId/restore",
  requireAccessToken,
  requireRole([...MANAGE_ROLES]),
  asyncHandler(async (req, res) => {
    res.json(await restoreProduct(req.params.storeId!, req.params.productId!));
  })
);

productsRouter.post(
  "/stores/:storeId/products/:productId/adjust-stock",
  requireAccessToken,
  requireRole([...MANAGE_ROLES]),
  asyncHandler(async (req, res) => {
    const { correctedStock } = adjustStockSchema.parse(req.body);
    res.json(await adjustStock(req.params.storeId!, req.params.productId!, correctedStock));
  })
);
