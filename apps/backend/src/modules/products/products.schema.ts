import { z } from "zod";

const currencySchema = z.enum(["USD", "KHR"]);

export const createProductSchema = z.object({
  name: z.string().min(1),
  barcode: z.string().min(1).nullable().optional(),
  category: z.string().nullable().optional(),
  price: z.number().nonnegative(),
  currency: currencySchema.default("USD"),
  costPrice: z.number().nonnegative().default(0),
  stock: z.number().int().default(0),
  lowStockThreshold: z.number().int().nonnegative().default(5),
});

export const updateProductSchema = z.object({
  name: z.string().min(1).optional(),
  barcode: z.string().min(1).nullable().optional(),
  category: z.string().nullable().optional(),
  price: z.number().nonnegative().optional(),
  currency: currencySchema.optional(),
  costPrice: z.number().nonnegative().optional(),
  stock: z.number().int().optional(),
  lowStockThreshold: z.number().int().nonnegative().optional(),
});

/** Mirrors the loosely-typed rows online-pos accepted from Excel/CSV import — validated/coerced row by row, not rejected as a batch. */
const bulkImportRowSchema = z.object({
  name: z.unknown().optional(),
  barcode: z.unknown().optional(),
  price: z.unknown().optional(),
  cost_price: z.unknown().optional(),
  currency: z.unknown().optional(),
  stock: z.unknown().optional(),
});

export const bulkImportSchema = z.object({
  products: z.array(bulkImportRowSchema).min(1),
  updateExisting: z.boolean().default(false),
});

export type BulkImportRow = z.infer<typeof bulkImportRowSchema>;
