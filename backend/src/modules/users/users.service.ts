import ms from "ms";
import { env } from "../../config/env.ts";
import { sendEmail } from "../../lib/email.ts";
import { generateOpaqueToken, hashOpaqueToken } from "../../lib/tokens.ts";
import {
  BadRequestError,
  ConflictError,
  NotFoundError,
} from "../../shared/errors.ts";
import { paginate } from "../../shared/pagination.ts";
import { Role } from "../../generated/prisma";
import * as membershipsRepository from "../memberships/memberships.repository.ts";
import * as staffInvitesRepository from "./staff-invites.repository.ts";
import * as authRepository from "../auth/auth.repository.ts";
import type {
  InviteStaffInput,
  UpdateMembershipInput,
} from "./users.validators.ts";

const INVITE_SUBJECT = "You've been added to a business on Inventory Manager";

/**
 * The staff list is a list of memberships, flattened back into the shape the
 * client already reads — `id` is the membership, not the person, because that
 * is what the row's actions operate on.
 */
function toStaffRow(membership: {
  id: string;
  role: Role;
  isActive: boolean;
  createdAt: Date;
  updatedAt: Date;
  user: {
    id: string;
    name: string;
    email: string;
    phone: string | null;
    lastLoginAt: Date | null;
  };
}) {
  return {
    id: membership.id,
    userId: membership.user.id,
    name: membership.user.name,
    email: membership.user.email,
    phone: membership.user.phone,
    role: membership.role,
    isActive: membership.isActive,
    lastLoginAt: membership.user.lastLoginAt,
    status: "ACTIVE" as const,
    createdAt: membership.createdAt,
    updatedAt: membership.updatedAt,
  };
}

/**
 * Pending invitations ride alongside the paginated memberships rather than
 * inside them: they aren't memberships yet, there are rarely more than a
 * handful, and mixing two tables into one paginated ordering would mean
 * sorting in memory over the whole staff list.
 */
export async function list(tenantId: string, rawQuery: unknown) {
  const page = await paginate(rawQuery, (skip, take, search) =>
    membershipsRepository
      .listForTenant(tenantId, skip, take, search)
      .then(([rows, total]): [ReturnType<typeof toStaffRow>[], number] => [
        rows.map(toStaffRow),
        total,
      ]),
  );
  const invites = await staffInvitesRepository.listPendingForTenant(tenantId);
  return {
    ...page,
    pendingInvites: invites.map((invite) => ({
      id: invite.id,
      name: invite.name,
      email: invite.email,
      role: invite.role,
      status: "INVITED" as const,
      expiresAt: invite.expiresAt,
      createdAt: invite.createdAt,
    })),
  };
}

/**
 * Adds a staff member by invitation. Both conflict checks are scoped to this
 * tenant — that scoping is the whole point: whether the address has an account
 * in some *other* business is deliberately invisible here, and does not block
 * the invite. The same response comes back either way.
 */
export async function invite(
  tenantId: string,
  invitedByUserId: string,
  input: InviteStaffInput,
) {
  const existingMembership = await membershipsRepository.findByEmailInTenant(
    tenantId,
    input.email,
  );
  if (existingMembership) {
    throw new ConflictError("This person is already on your staff list", {
      email: ["This person is already on your staff list"],
    });
  }

  const token = generateOpaqueToken();
  const ttlMs = ms(env.STAFF_INVITE_TTL as ms.StringValue);
  const invitation = await staffInvitesRepository.upsert({
    tenantId,
    email: input.email,
    name: input.name,
    role: input.role,
    tokenHash: hashOpaqueToken(token),
    expiresAt: new Date(Date.now() + ttlMs),
    invitedByUserId,
  });

  // Only the hash is stored, so this is the one moment the raw token exists.
  const link = `${env.FRONTEND_URL}/accept-invite?token=${token}`;
  try {
    await sendEmail(
      input.email,
      INVITE_SUBJECT,
      `You've been added as ${input.role} on Inventory Manager. Set up your access here: ${link}\n\nThis link expires in ${ms(ttlMs, { long: true })}. If you already have an account with this email address, you'll be asked for its password and the business will simply be added to it.`,
    );
  } catch (error) {
    console.error(
      `Failed to send staff invitation to ${input.email}: ${(error as Error).message}`,
    );
  }

  return {
    id: invitation.id,
    name: invitation.name,
    email: invitation.email,
    role: invitation.role,
    status: "INVITED" as const,
    expiresAt: invitation.expiresAt,
    createdAt: invitation.createdAt,
  };
}

export function revokeInvite(tenantId: string, id: string) {
  return staffInvitesRepository
    .findByIdInTenant(tenantId, id)
    .then(async (invitation) => {
      if (!invitation) {
        throw new NotFoundError("Invitation not found");
      }
      await staffInvitesRepository.remove(invitation.id);
      return invitation;
    });
}

/**
 * Guards the one change that can lock a business out of itself. Scoped to this
 * tenant's memberships — an owner elsewhere is no help here.
 */
async function assertNotLastOwner(
  tenantId: string,
  membership: { userId: string; role: Role; isActive: boolean },
  next: { role?: Role; isActive?: boolean },
) {
  const losingOwnerStatus =
    membership.role === Role.OWNER &&
    membership.isActive &&
    ((next.role !== undefined && next.role !== Role.OWNER) ||
      (next.isActive !== undefined && !next.isActive));

  if (!losingOwnerStatus) return;

  const remaining = await membershipsRepository.countActiveOwners(
    tenantId,
    membership.userId,
  );
  if (remaining === 0) {
    throw new BadRequestError(
      "Cannot remove the last active owner of this business",
    );
  }
}

async function requireMembership(tenantId: string, id: string) {
  const membership = await membershipsRepository.findByIdInTenant(tenantId, id);
  if (!membership) {
    throw new NotFoundError("Staff member not found");
  }
  return membership;
}

export async function update(
  tenantId: string,
  id: string,
  input: UpdateMembershipInput,
) {
  const membership = await requireMembership(tenantId, id);
  await assertNotLastOwner(tenantId, membership, input);

  const updated = await membershipsRepository.update(membership.id, input);

  // Role/active-status changes must take effect immediately, not whenever the
  // user's current access token happens to expire — revoke their sessions so
  // the next request re-authenticates with the new privileges. Scoped to this
  // tenant: their sessions in other businesses are unaffected by a decision
  // made here.
  if (input.role !== undefined || input.isActive !== undefined) {
    await authRepository.revokeRefreshTokensForUserInTenant(
      membership.userId,
      tenantId,
    );
  }

  return updated;
}

/**
 * Removes someone from this business entirely. Their identity, and any other
 * business they work in, is untouched — which is exactly the difference
 * between a membership and the old tenant-scoped user row.
 */
export async function remove(tenantId: string, id: string) {
  const membership = await requireMembership(tenantId, id);
  await assertNotLastOwner(tenantId, membership, { isActive: false });
  await membershipsRepository.remove(membership.id);
  await authRepository.revokeRefreshTokensForUserInTenant(
    membership.userId,
    tenantId,
  );
  return membership;
}
