import { z } from "zod";

export const activityFilterSchema = z.object({
  userId: z.string().trim().optional(),
  action: z.string().trim().optional(),
  from: z.coerce.date().optional(),
  to: z.coerce.date().optional(),
});

export type ActivityFilterInput = z.infer<typeof activityFilterSchema>;
