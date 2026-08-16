import { z } from "zod";

const money = z
  .string()
  .trim()
  .regex(/^\d+(\.\d{1,2})?$/, "Must be an amount like 120 or 120.50");

export const openShiftSchema = z.object({
  locationId: z.string().trim().min(1),
  openingFloat: money,
});

export const closeShiftSchema = z.object({
  countedCash: money,
  notes: z.string().trim().max(500).optional(),
});

export type OpenShiftInput = z.infer<typeof openShiftSchema>;
export type CloseShiftInput = z.infer<typeof closeShiftSchema>;
