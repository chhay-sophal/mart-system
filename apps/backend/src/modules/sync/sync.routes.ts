import { Router } from "express";
import { asyncHandler } from "../../middleware/asyncHandler";
import { requireTerminal } from "../../middleware/requireTerminal";
import { syncPullQuerySchema, syncPushSchema } from "./sync.schema";
import { pullCatalog, pushEvents } from "./sync.service";

export const syncRouter: Router = Router();

syncRouter.post(
  "/sync/push",
  requireTerminal,
  asyncHandler(async (req, res) => {
    const { events } = syncPushSchema.parse(req.body);
    const results = await pushEvents(req.terminal!, events);
    res.json({ results });
  })
);

syncRouter.get(
  "/sync/pull",
  requireTerminal,
  asyncHandler(async (req, res) => {
    const { since } = syncPullQuerySchema.parse(req.query);
    res.json(await pullCatalog(req.terminal!.storeId, since));
  })
);
