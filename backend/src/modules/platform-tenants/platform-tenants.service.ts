import { SubscriptionStatus } from "../../generated/prisma/enums.ts";
import { logActivity } from "../../lib/activity-logger.ts";
import { BadRequestError, NotFoundError } from "../../shared/errors.ts";
import { paginate } from "../../shared/pagination.ts";
import * as platformTenantsRepository from "./platform-tenants.repository.ts";
import type { SuspendTenantInput } from "./platform-tenants.validators.ts";

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

export function stats() {
  return platformTenantsRepository.stats();
}
