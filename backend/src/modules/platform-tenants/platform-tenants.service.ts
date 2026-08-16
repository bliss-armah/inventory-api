import { SubscriptionStatus } from "../../generated/prisma/enums.ts";
import { logActivity } from "../../lib/activity-logger.ts";
import { BadRequestError, NotFoundError } from "../../shared/errors.ts";
import { paginate } from "../../shared/pagination.ts";
import { randomUUID } from "node:crypto";
import { hashPassword } from "../../lib/password.ts";
import { sendOwnerInvite } from "../../lib/owner-invite.ts";
import { withUniqueConstraint } from "../../shared/prisma-errors.ts";
import * as platformTenantsRepository from "./platform-tenants.repository.ts";
import * as authRepository from "../auth/auth.repository.ts";
import { assertInventoryModeChangeAllowed } from "../tenants/tenants.service.ts";
import type {
  EntitlementsInput,
  PlatformCreateTenantInput,
  SuspendTenantInput,
} from "./platform-tenants.validators.ts";

export function list(rawQuery: unknown) {
  return paginate(rawQuery, (skip, take, search) =>
    platformTenantsRepository.list(skip, take, search),
  );
}

export async function findOne(id: string) {
  const tenant = await platformTenantsRepository.findById(id);
  if (!tenant) {
    throw new NotFoundError("Tenant not found");
  }
  return tenant;
}

export async function suspend(id: string, input: SuspendTenantInput) {
  const tenant = await findOne(id);
  if (tenant.subscriptionStatus === SubscriptionStatus.SUSPENDED) {
    throw new BadRequestError("Tenant is already suspended");
  }

  const updated = await platformTenantsRepository.updateSubscriptionStatus(
    id,
    SubscriptionStatus.SUSPENDED,
    { suspendedAt: new Date(), suspendedReason: input.reason ?? null },
  );

  // Suspension must take effect immediately, not whenever each user's
  // current session naturally expires.
  await platformTenantsRepository.revokeAllRefreshTokensForTenant(id);

  await logActivity({
    tenantId: id,
    action: "TENANT_SUSPENDED",
    description: input.reason
      ? `Business suspended by platform: ${input.reason}`
      : "Business suspended by platform",
  });

  return updated;
}

export async function reactivate(id: string) {
  const tenant = await findOne(id);
  if (tenant.subscriptionStatus !== SubscriptionStatus.SUSPENDED) {
    throw new BadRequestError("Tenant is not currently suspended");
  }

  const updated = await platformTenantsRepository.updateSubscriptionStatus(
    id,
    SubscriptionStatus.ACTIVE,
    { suspendedAt: null, suspendedReason: null },
  );

  await logActivity({
    tenantId: id,
    action: "TENANT_REACTIVATED",
    description: "Business reactivated by platform",
  });

  return updated;
}

/**
 * Onboards a business: profile, owner, and entitlements together. The owner is
 * created with a random password hash they never see and is sent an invite to
 * set their own, so no credential is ever handled on their behalf or returned
 * from this call.
 */
export async function createTenant(input: PlatformCreateTenantInput) {
  const {
    inventoryMode,
    enablePos,
    enableBatchTracking,
    enableExpiryTracking,
    ...profile
  } = input;

  // Random rather than empty or fixed: until the invite is used there must be
  // no password that could possibly authenticate.
  const unusablePasswordHash = await hashPassword(randomUUID());

  const { tenant, owner } = await withUniqueConstraint(
    () =>
      authRepository.createTenantWithOwner(profile, unusablePasswordHash, {
        inventoryMode,
        enablePos,
        enableBatchTracking,
        enableExpiryTracking,
      }),
    { field: "email", message: "An account with this email already exists" },
  );

  // Sent inside the request on purpose: sendEmail throws in production when no
  // provider is configured, and an owner who can never sign in must not be
  // reported as a successful onboarding.
  await sendOwnerInvite({
    tenantId: tenant.id,
    userId: owner.id,
    email: owner.email,
    businessName: tenant.businessName,
  });

  await logActivity({
    tenantId: tenant.id,
    action: "TENANT_CREATED_BY_PLATFORM",
    description: `${tenant.businessName} was created by a platform administrator`,
  });

  // Only the owner's identity, never their credential.
  return {
    tenant,
    owner: { id: owner.id, name: owner.name, email: owner.email },
  };
}

/**
 * Assigns what a business is provisioned for. findOne first so an unknown id
 * is a 404 rather than a Prisma "record not found" surfacing as a 500, and the
 * inventory-mode guard is shared with the owner-facing path so switching to
 * single-location can't strand stock at a location the app stops showing.
 */
export async function updateEntitlements(id: string, input: EntitlementsInput) {
  const tenant = await findOne(id);
  await assertInventoryModeChangeAllowed(tenant.id, input.inventoryMode);

  const settings = await platformTenantsRepository.updateEntitlements(tenant.id, input);

  // No userId: the actor is a platform admin, not a user inside this tenant —
  // same as suspend/reactivate above.
  await logActivity({
    tenantId: tenant.id,
    action: "ENTITLEMENTS_UPDATED",
    description: `Features set by platform: ${Object.entries(input)
      .map(([key, value]) => `${key}=${value}`)
      .join(", ")}`,
  });

  return settings;
}

export function stats() {
  return platformTenantsRepository.stats();
}
