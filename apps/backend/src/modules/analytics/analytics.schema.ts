import { z } from "zod";

const date = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Expected a YYYY-MM-DD date");

// Longest range the page asks for is 12 months; a little room beyond that.
export const MAX_ANALYTICS_DAYS = 400;

export const analyticsQuerySchema = z
  .object({
    storeId: z.string().min(1).optional(),
    from: date,
    to: date,
  })
  .refine((q) => q.from <= q.to, { message: "from must not be after to" })
  .refine(
    (q) => (Date.parse(`${q.to}T00:00:00Z`) - Date.parse(`${q.from}T00:00:00Z`)) / 86_400_000 + 1 <= MAX_ANALYTICS_DAYS,
    { message: `At most ${MAX_ANALYTICS_DAYS} days at a time` }
  );
