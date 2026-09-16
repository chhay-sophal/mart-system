import { z } from "zod";

export const createTerminalSchema = z.object({
  name: z.string().min(1),
});

export const updateTerminalSchema = z.object({
  name: z.string().min(1).optional(),
  isActive: z.boolean().optional(),
});
