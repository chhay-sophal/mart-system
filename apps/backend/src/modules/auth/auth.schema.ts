import { z } from "zod";

export const loginSchema = z.object({
  email: z.string().email(),
  password: z.string().min(1),
});

export const refreshSchema = z.object({
  refreshToken: z.string().min(1),
});

export const pinLoginSchema = z.object({
  terminalId: z.string().min(1),
  storeId: z.string().min(1),
  pin: z.string().min(4).max(8),
});
