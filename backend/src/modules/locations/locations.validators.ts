import { z } from "zod";
import { LocationStatus, LocationType } from "../../generated/prisma/enums.ts";

export const createLocationSchema = z.object({
  name: z.string().trim().min(2).max(120),
  type: z.enum(LocationType).default(LocationType.OTHER),
  address: z.string().trim().max(240).optional(),
  description: z.string().trim().max(500).optional(),
});

export const updateLocationSchema = z.object({
  name: z.string().trim().min(2).max(120).optional(),
  type: z.enum(LocationType).optional(),
  address: z.string().trim().max(240).optional(),
  description: z.string().trim().max(500).optional(),
  status: z.enum(LocationStatus).optional(),
});

export type CreateLocationInput = z.infer<typeof createLocationSchema>;
export type UpdateLocationInput = z.infer<typeof updateLocationSchema>;
