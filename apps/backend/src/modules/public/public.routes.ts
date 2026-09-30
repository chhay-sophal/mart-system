import { Router } from "express";
import { asyncHandler } from "../../middleware/asyncHandler";
import { createRequestRateLimiter } from "../../middleware/rateLimiter";
import { env } from "../../env";
import { badRequest } from "../../lib/httpError";
import { listPublicProductsQuerySchema } from "./public.schema";
import { placeOnlineOrderSchema } from "../onlineOrders/onlineOrders.schema";
import {
  getOnlineOrderByToken,
  getPickupSlots,
  placeOnlineOrder,
  toPublicOrder,
} from "../onlineOrders/onlineOrders.service";
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

publicRouter.get(
  "/stores/:storeId/pickup-slots",
  asyncHandler(async (req, res) => {
    res.json(await getPickupSlots(req.params.storeId!));
  })
);

// Placing orders reserves stock, so it gets a much tighter cap than browsing:
// 5 per IP per 10 minutes. Skipped under test, where every request shares one IP;
// the limiter itself is covered by its own test.
const placeOrderLimiter =
  env.NODE_ENV === "test"
    ? (_req: unknown, _res: unknown, next: () => void) => next()
    : createRequestRateLimiter({ max: 5, windowMs: 10 * 60_000 });

publicRouter.post(
  "/stores/:storeId/orders",
  placeOrderLimiter,
  asyncHandler(async (req, res) => {
    const input = placeOnlineOrderSchema.parse(req.body);
    // KHQR checkout lands in the next step (onlineOrderPayments); pay at the counter works now.
    if (input.paymentMethod === "KHQR") throw badRequest("KHQR isn't available for online orders yet");
    const order = await placeOnlineOrder(req.params.storeId!, input);
    res.status(201).json(toPublicOrder(order));
  })
);

publicRouter.get(
  "/orders/:token",
  asyncHandler(async (req, res) => {
    res.json(toPublicOrder(await getOnlineOrderByToken(req.params.token!)));
  })
);
