import { Router } from "express";
import { asyncHandler } from "../../middleware/asyncHandler";
import { createRequestRateLimiter } from "../../middleware/rateLimiter";
import { listPublicProductsQuerySchema } from "./public.schema";
import {
  getPublicProduct,
  getPublicProductAvailability,
  getPublicStoreOrThrow,
  listPublicProducts,
  listPublicStores,
} from "./public.service";

/**
 * Unauthenticated, read-only storefront API. Everything here is visible to
 * anyone on the internet — only return shapes from @mart-system/shared-types'
 * public.ts, never the staff-facing views.
 */
export const publicRouter: Router = Router();

// A shopper browsing aisles makes a handful of requests per page; 120/min per
// IP leaves plenty of headroom while stopping a scraper hammering the catalog.
publicRouter.use(createRequestRateLimiter({ max: 120, windowMs: 60_000 }));

publicRouter.get(
  "/stores",
  asyncHandler(async (_req, res) => {
    res.json(await listPublicStores());
  })
);

publicRouter.get(
  "/stores/:storeId",
  asyncHandler(async (req, res) => {
    res.json(await getPublicStoreOrThrow(req.params.storeId!));
  })
);

publicRouter.get(
  "/stores/:storeId/products",
  asyncHandler(async (req, res) => {
    const filter = listPublicProductsQuerySchema.parse(req.query);
    res.json(await listPublicProducts(req.params.storeId!, filter));
  })
);

publicRouter.get(
  "/stores/:storeId/products/:productId",
  asyncHandler(async (req, res) => {
    res.json(await getPublicProduct(req.params.storeId!, req.params.productId!));
  })
);

publicRouter.get(
  "/products/:productId/availability",
  asyncHandler(async (req, res) => {
    res.json(await getPublicProductAvailability(req.params.productId!));
  })
);
