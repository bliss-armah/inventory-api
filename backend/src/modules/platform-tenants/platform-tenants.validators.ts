import { z } from "zod";

export const suspendTenantSchema = z.object({
  reason: z.string().trim().max(500).optional(),
});

export type SuspendTenantInput = z.infer<typeof suspendTenantSchema>;
