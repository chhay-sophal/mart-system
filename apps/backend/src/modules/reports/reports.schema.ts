import { z } from "zod";

export const negativeStockQuerySchema = z.object({
  storeId: z.string().min(1).optional(),
});

export const dailySummaryQuerySchema = z.object({
  storeId: z.string().min(1).optional(),
  date_from: z.string().min(1),
  date_to: z.string().min(1),
});
