import { z } from "zod";

// One online-pos (backend-desktop/server.js) order with its items, as IMS
// reads it out of the old database.sqlite. Validated per order in the
// service, so one bad row doesn't fail the whole batch.
export const legacyOrderSchema = z.object({
  legacyId: z.number().int().positive(),
  // Shop-local wall-clock time as online-pos stored it ("YYYY-MM-DD HH:mm:ss").
  createdAt: z.string().regex(/^\d{4}-\d{2}-\d{2}[ T]\d{2}:\d{2}(:\d{2})?$/, "expected YYYY-MM-DD HH:mm:ss"),
  paymentMethod: z.string().min(1),
  bankName: z.string().nullable(),
  totalAmount: z.number().nonnegative(),
  currency: z.enum(["USD", "KHR"]),
  amountPaidUsd: z.number().nonnegative(),
  amountPaidKhr: z.number().nonnegative(),
  changeGivenKhr: z.number().nonnegative(),
  status: z.string(),
  isDeleted: z.boolean(),
  items: z
    .array(
      z.object({
        barcode: z.string().nullable(),
        name: z.string().min(1),
        quantity: z.number().int().positive(),
        priceAtSale: z.number().nonnegative(),
        currency: z.enum(["USD", "KHR"]),
      })
    )
    .min(1),
});

export type LegacyOrder = z.infer<typeof legacyOrderSchema>;

export const importLegacyOrdersSchema = z.object({
  // Identifies the online-pos install the file came from (IMS derives it from
  // the file's first order), so backups of the same install map to the same
  // order IDs and re-importing a newer backup skips what's already in.
  sourceId: z.string().regex(/^[a-zA-Z0-9_-]{8,64}$/),
  orders: z.array(z.unknown()).min(1).max(200),
});
