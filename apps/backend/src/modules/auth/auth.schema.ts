import { z } from "zod";
import { pinSchema } from "../staff/staff.schema";

export const loginSchema = z.object({
  // Only normalized here, not format-checked: a malformed username just fails
  // as an unknown one, with the same 401 as a wrong password.
  username: z.string().trim().toLowerCase().min(1),
  password: z.string().min(1),
});

export const refreshSchema = z.object({
  refreshToken: z.string().min(1),
});

export const pinLoginSchema = z.object({
  terminalId: z.string().min(1),
  storeId: z.string().min(1),
  pin: pinSchema,
});
