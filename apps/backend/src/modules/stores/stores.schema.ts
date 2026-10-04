import { z } from "zod";

export const updateStoreSchema = z.object({
  name: z.string().min(1).optional(),
  address: z.string().nullable().optional(),
  phone: z.string().nullable().optional(),
  timezone: z.string().min(1).optional(),
  isActive: z.boolean().optional(),
});

// Keys POS terminals apply as-is on sync, so a bad value here would break every
// register in the store. Other keys stay free-form.
const SYNCED_SETTING_RULES: Record<string, z.ZodType<string>> = {
  main_currency: z.enum(["USD", "KHR"]),
  locale: z.enum(["km", "en"]),
  exchange_rate: z.string().refine((v) => Number(v) > 0, "must be a positive number"),
  // IMS downsizes to 256px before upload; the cap keeps a raw photo from being
  // re-sent to every terminal (and stays under express.json's 100kb limit).
  store_icon: z
    .string()
    .max(90_000, "image too large")
    .refine((v) => v === "" || /^data:image\/(png|jpeg|webp|gif);base64,/.test(v), "must be an image data URL"),
};

export const putSettingsSchema = z.object({
  settings: z.record(z.string(), z.string()).superRefine((settings, ctx) => {
    for (const [key, rule] of Object.entries(SYNCED_SETTING_RULES)) {
      if (!(key in settings)) continue;
      const result = rule.safeParse(settings[key]);
      if (!result.success) {
        ctx.addIssue({ code: "custom", path: [key], message: `Invalid ${key}: ${result.error.issues[0]?.message}` });
      }
    }
  }),
});
