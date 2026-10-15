import { z } from "zod";

const roleSchema = z.enum(["CASHIER", "INVENTORY", "ADMIN"]);
// Every PIN is exactly 4 digits: the POS lock screen has four places and
// unlocks as soon as the fourth digit is entered.
export const pinSchema = z.string().regex(/^[0-9]{4}$/, "PIN must be exactly 4 digits");
// Case-insensitive: always stored and looked up lowercase. "@" is allowed so
// accounts migrated from email logins keep their email as their username.
export const usernameSchema = z
  .string()
  .trim()
  .toLowerCase()
  .regex(/^[a-z0-9._@-]{3,50}$/, "Username must be 3-50 characters: letters, numbers, . _ - @");

// A cashier only ever logs into the till with a PIN, never a username/password
// in IMS, so both are optional for that role; createStaff fills in a
// generated placeholder. Every other role manages IMS access directly and
// must supply real credentials. Email is an optional contact field for anyone.
export const createStaffSchema = z
  .object({
    username: usernameSchema.optional(),
    email: z.string().email().optional(),
    name: z.string().min(1),
    password: z.string().min(8).optional(),
    role: roleSchema,
    pin: pinSchema.optional(),
  })
  .superRefine((data, ctx) => {
    if (data.role === "CASHIER") return;
    if (data.username === undefined) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, path: ["username"], message: "Required" });
    }
    if (data.password === undefined) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, path: ["password"], message: "Required" });
    }
  });

export const updateStaffSchema = z.object({
  name: z.string().min(1).optional(),
  username: usernameSchema.optional(),
  email: z.string().email().optional(),
  password: z.string().min(8).optional(),
  role: roleSchema.optional(),
  isActive: z.boolean().optional(),
  pin: pinSchema.optional(),
});

export const resetPinSchema = z.object({
  pin: pinSchema,
});
