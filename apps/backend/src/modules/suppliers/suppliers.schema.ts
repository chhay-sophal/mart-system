import { z } from "zod";

export const createSupplierSchema = z.object({
  name: z.string().min(1),
  phone1: z.string().min(1),
  phone2: z.string().min(1).nullable().optional(),
  email: z.string().email().nullable().optional(),
  address: z.string().nullable().optional(),
});

export const updateSupplierSchema = z.object({
  name: z.string().min(1).optional(),
  phone1: z.string().min(1).optional(),
  phone2: z.string().min(1).nullable().optional(),
  email: z.string().email().nullable().optional(),
  address: z.string().nullable().optional(),
});
