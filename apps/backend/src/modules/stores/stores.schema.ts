import { z } from "zod";

// "HH:MM", 24-hour. "24:00" is accepted as a closing time only (open until midnight).
const TIME_RE = /^([01]\d|2[0-3]):[0-5]\d$/;

const dayHoursSchema = z
  .object({
    open: z.string().regex(TIME_RE, 'Use 24-hour "HH:MM"'),
    close: z.string().refine((v) => v === "24:00" || TIME_RE.test(v), 'Use 24-hour "HH:MM" (or "24:00")'),
  })
  // close < open is allowed: hours that run past midnight (18:00 → 02:00).
  .refine((d) => d.open !== d.close, { message: "Opening and closing times can't be the same" });

/** Shape of shared-types' OpeningHours — every weekday required, null = closed that day. */
export const openingHoursSchema = z.object({
  mon: dayHoursSchema.nullable(),
  tue: dayHoursSchema.nullable(),
  wed: dayHoursSchema.nullable(),
  thu: dayHoursSchema.nullable(),
  fri: dayHoursSchema.nullable(),
  sat: dayHoursSchema.nullable(),
  sun: dayHoursSchema.nullable(),
});

export const updateStoreSchema = z
  .object({
    name: z.string().min(1).optional(),
    address: z.string().nullable().optional(),
    phone: z.string().nullable().optional(),
    timezone: z.string().min(1).optional(),
    isActive: z.boolean().optional(),
    openingHours: openingHoursSchema.nullable().optional(),
    latitude: z.number().min(-90).max(90).nullable().optional(),
    longitude: z.number().min(-180).max(180).nullable().optional(),
  })
  // A pin needs both coordinates — reject setting or clearing just one.
  .refine((s) => (s.latitude === undefined) === (s.longitude === undefined), {
    message: "latitude and longitude must be sent together",
    path: ["latitude"],
  })
  .refine((s) => (s.latitude === null) === (s.longitude === null), {
    message: "latitude and longitude must both be set or both be cleared",
    path: ["latitude"],
  });

export const putSettingsSchema = z.object({
  settings: z.record(z.string(), z.string()),
});
