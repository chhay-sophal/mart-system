import { z } from "zod";

const roleSchema = z.enum(["CASHIER", "INVENTORY", "ADMIN"]);
// Every PIN is exactly 4 digits: the POS lock screen has four places and
// unlocks as soon as the fourth digit is entered.
export const pinSchema = z.string().regex(/^[0-9]{4}$/, "PIN must be exactly 4 digits");

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
