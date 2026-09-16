import { z } from "zod";

const roleSchema = z.enum(["CASHIER", "INVENTORY", "ADMIN"]);
const pinSchema = z.string().min(4).max(8);

export const createStaffSchema = z.object({
  email: z.string().email(),
  name: z.string().min(1),
  password: z.string().min(8),
  role: roleSchema,
  pin: pinSchema.optional(),
});

export const updateStaffSchema = z.object({
  role: roleSchema.optional(),
  isActive: z.boolean().optional(),
});

export const resetPinSchema = z.object({
  pin: pinSchema,
});
