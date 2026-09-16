import { z } from "zod";

export const updateStoreSchema = z.object({
  name: z.string().min(1).optional(),
  address: z.string().nullable().optional(),
  phone: z.string().nullable().optional(),
  timezone: z.string().min(1).optional(),
  isActive: z.boolean().optional(),
});

export const putSettingsSchema = z.object({
  settings: z.record(z.string(), z.string()),
});
