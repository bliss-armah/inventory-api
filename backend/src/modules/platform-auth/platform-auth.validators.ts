import { z } from "zod";

export const platformLoginSchema = z.object({
  email: z.email().toLowerCase(),
  password: z.string().min(1),
});

export type PlatformLoginInput = z.infer<typeof platformLoginSchema>;
