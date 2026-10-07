import { z } from "zod";

const roleSchema = z.enum(["CASHIER", "INVENTORY", "ADMIN"]);
// Every PIN is exactly 4 digits: the POS lock screen has four places and
// unlocks as soon as the fourth digit is entered.
export const pinSchema = z.string().regex(/^[0-9]{4}$/, "PIN must be exactly 4 digits");

// A cashier only ever logs into the till with a PIN, never an email/password
// in IMS, so both are optional for that role; createStaff fills in a
// generated placeholder. Every other role manages IMS access directly and
// must supply real credentials.
export const createStaffSchema = z
  .object({
    email: z.string().email().optional(),
    name: z.string().min(1),
    password: z.string().min(8).optional(),
    role: roleSchema,
    pin: pinSchema.optional(),
  })
  .superRefine((data, ctx) => {
    if (data.role === "CASHIER") return;
    if (data.email === undefined) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, path: ["email"], message: "Required" });
    }
    if (data.password === undefined) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, path: ["password"], message: "Required" });
    }
  });

export const updateStaffSchema = z.object({
  name: z.string().min(1).optional(),
  email: z.string().email().optional(),
  password: z.string().min(8).optional(),
  role: roleSchema.optional(),
  isActive: z.boolean().optional(),
  pin: pinSchema.optional(),
});

export const resetPinSchema = z.object({
  pin: pinSchema,
});
