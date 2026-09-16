import { z } from "zod";

export const generateKhqrSchema = z.object({
  amount: z.number().positive(),
  currency: z.enum(["USD", "KHR"]),
});

export const bakongCredentialSchema = z.object({
  registeredEmail: z.string().email(),
});
