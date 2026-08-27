import { z } from "zod";
import { Role } from "../../generated/prisma";

/**
 * Inviting a staff member no longer sets a password, and no longer takes a
 * phone number. Both belong to the person's identity, which may already exist
 * in another business — an owner here has no standing to set either. The
 * invitee supplies them when they accept.
 */
export const inviteStaffSchema = z.object({
  name: z.string().trim().min(2).max(120),
  email: z.email().toLowerCase(),
  role: z.enum(Role),
});

/**
 * Only the membership is editable from the staff page: what this person may do
 * *here*, and whether they may still sign in *here*. Their name and phone live
 * on the identity and are theirs to change, in Settings.
 */
export const updateMembershipSchema = z.object({
  role: z.enum(Role).optional(),
  isActive: z.boolean().optional(),
});

export type InviteStaffInput = z.infer<typeof inviteStaffSchema>;
export type UpdateMembershipInput = z.infer<typeof updateMembershipSchema>;
