import { Router } from "express";
import { z } from "zod";
import { asyncHandler } from "../../middleware/asyncHandler";
import { requireTerminal } from "../../middleware/requireTerminal";
import { listStoreOrders, storeDailySummary } from "./terminalReports.service";

export const terminalReportsRouter: Router = Router();

const isoDate = z.string().datetime({ offset: true });

const ordersQuerySchema = z.object({
  date_from: isoDate.optional(),
  date_to: isoDate.optional(),
  limit: z.coerce.number().int().min(1).max(2000).default(1000),
});

const summaryQuerySchema = z.object({ date_from: isoDate, date_to: isoDate });

// Called by a paired register's sidecar with its terminal credentials, so a
// terminal only ever sees its own store.
terminalReportsRouter.get(
  "/terminal/orders",
  requireTerminal,
  asyncHandler(async (req, res) => {
    const { date_from, date_to, limit } = ordersQuerySchema.parse(req.query);
    res.json(
      await listStoreOrders(req.terminal!.storeId, {
        dateFrom: date_from ? new Date(date_from) : undefined,
        dateTo: date_to ? new Date(date_to) : undefined,
        limit,
      })
    );
  })
);

terminalReportsRouter.get(
  "/terminal/daily-summary",
  requireTerminal,
  asyncHandler(async (req, res) => {
    const { date_from, date_to } = summaryQuerySchema.parse(req.query);
    res.json(await storeDailySummary(req.terminal!.storeId, new Date(date_from), new Date(date_to)));
  })
);
