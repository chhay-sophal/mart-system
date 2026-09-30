import { z } from "zod";

export const MAX_LINES = 50;
export const MAX_QTY_PER_LINE = 99;

/**
 * Cambodian numbers as shoppers type them — "012 345 678", "+855 12 345 678",
 * "85512345678" — normalised to the local "0XXXXXXXX" form (8–9 digits after the 0).
 */
export function normalizePhone(raw: string): string | null {
  let digits = raw.replace(/\D/g, "");
  if (digits.startsWith("855")) digits = `0${digits.slice(3)}`;
  return /^0\d{8,9}$/.test(digits) ? digits : null;
}

export const placeOnlineOrderSchema = z.object({
  clientOrderUuid: z.string().uuid(),
  items: z
    .array(
      z.object({
        productId: z.string().min(1),
        quantity: z.number().int().min(1).max(MAX_QTY_PER_LINE),
      })
    )
    .min(1, "Your cart is empty")
    .max(MAX_LINES),
  customerName: z.string().trim().min(1, "Please enter your name").max(80),
  customerPhone: z.string().transform((v, ctx) => {
    const phone = normalizePhone(v);
    if (!phone) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, message: "Please enter a Cambodian phone number, e.g. 012 345 678" });
      return z.NEVER;
    }
    return phone;
  }),
  note: z.string().trim().max(300).nullable().optional(),
  pickupAt: z.string().datetime().nullable(),
  paymentMethod: z.enum(["KHQR", "PAY_AT_COUNTER"]),
});

export type PlaceOnlineOrderInput = z.infer<typeof placeOnlineOrderSchema>;
