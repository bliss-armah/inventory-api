import { z } from "zod";

const money = z
  .string()
  .trim()
  .regex(/^\d+(\.\d{1,2})?$/, "Must be an amount like 120 or 120.50");

/**
 * `locationId` is optional because choosing between locations is an owner
 * concern — cashiers can't read `/locations` at all (PERMISSIONS.locations.view
 * is owner-only), so the till has no way to name one. Omitted means "resolve it
 * server-side"; see shifts.service.ts resolveLocationId.
 */
export const openShiftSchema = z.object({
  locationId: z.string().trim().min(1).optional(),
  openingFloat: money,
});

export const closeShiftSchema = z.object({
  countedCash: money,
  notes: z.string().trim().max(500).optional(),
});

export type OpenShiftInput = z.infer<typeof openShiftSchema>;
export type CloseShiftInput = z.infer<typeof closeShiftSchema>;
