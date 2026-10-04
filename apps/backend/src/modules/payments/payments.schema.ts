import { z } from "zod";

const optionalText = z.string().trim().max(100).optional();

export const generateKhqrSchema = z.object({
  amount: z.number().positive(),
  currency: z.enum(["USD", "KHR"]),
  // Branch-specific merchant details kept on the register (issue #5). Used
  // for this QR only, never stored; older registers that don't send them fall
  // back to the store's settings.
  bakongAccountId: optionalText,
  merchantName: optionalText,
  merchantCity: optionalText,
  storePhone: optionalText,
});

export const bakongCredentialSchema = z.object({
  registeredEmail: z.string().email(),
});
