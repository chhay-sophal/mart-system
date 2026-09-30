import { z } from "zod";

export const listPublicProductsQuerySchema = z.object({
  category: z.string().min(1).optional(),
});
