import { z } from "zod";
import { MovementType } from "../../generated/prisma/enums.ts";

export const movementFilterSchema = z.object({
  productId: z.string().trim().optional(),
  locationId: z.string().trim().optional(),
  type: z.enum(MovementType).optional(),
  from: z.coerce.date().optional(),
  to: z.coerce.date().optional(),
});

export type MovementFilterInput = z.infer<typeof movementFilterSchema>;
