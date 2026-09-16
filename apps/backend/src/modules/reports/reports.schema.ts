import { z } from "zod";

export const negativeStockQuerySchema = z.object({
  storeId: z.string().min(1).optional(),
});
