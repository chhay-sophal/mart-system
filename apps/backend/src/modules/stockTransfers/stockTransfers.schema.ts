import { z } from "zod";

export const createTransferSchema = z.object({
  fromStoreId: z.string().min(1),
  toStoreId: z.string().min(1),
  items: z
    .array(
      z.object({
        productId: z.string().min(1),
        quantity: z.number().int().positive(),
      })
    )
    .min(1),
});

export const listTransfersQuerySchema = z.object({
  storeId: z.string().min(1).optional(),
});
