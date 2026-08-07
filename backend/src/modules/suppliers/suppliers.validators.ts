import { z } from "zod";

export const createSupplierSchema = z.object({
  name: z.string().trim().min(1).max(120),
  contactPerson: z.string().trim().max(120).optional(),
  phone: z.string().trim().max(20).optional(),
  email: z.email().optional(),
  address: z.string().trim().max(240).optional(),
});

export const updateSupplierSchema = createSupplierSchema.partial();

export type CreateSupplierInput = z.infer<typeof createSupplierSchema>;
export type UpdateSupplierInput = z.infer<typeof updateSupplierSchema>;
