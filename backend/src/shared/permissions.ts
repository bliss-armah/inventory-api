import { Role } from "../generated/prisma/enums.ts";

/**
 * Single source of truth for which roles can do what. Every routes.ts
 * imports from here instead of hardcoding `authorize(Role.X, Role.Y)`
 * inline, so the whole access-control surface can be audited (and changed)
 * by reading one file. This is still a code-level config — a fully dynamic,
 * per-tenant-configurable permission system (DB-backed, editable without a
 * redeploy) is a bigger follow-on, not attempted here.
 */
export const PERMISSIONS = {
  categories: {
    view: [Role.OWNER],
    manage: [Role.OWNER],
  },
  brands: {
    view: [Role.OWNER],
    manage: [Role.OWNER],
  },
  suppliers: {
    view: [Role.OWNER],
    manage: [Role.OWNER],
  },
  locations: {
    view: [Role.OWNER],
    manage: [Role.OWNER],
  },
  products: {
    manage: [Role.OWNER],
    view: [Role.OWNER],
  },
  stockAdjustments: {
    view: [Role.OWNER],
    create: [Role.OWNER],
  },
  inventory: {
    view: [Role.OWNER],
  },
  purchaseOrders: {
    create: [Role.OWNER],
    submit: [Role.OWNER],
    approve: [Role.OWNER],
    cancel: [Role.OWNER],
    receive: [Role.OWNER],
    view: [Role.OWNER],
  },
  stockTransfers: {
    view: [Role.OWNER],
    manage: [Role.OWNER],
  },
  stockCounts: {
    view: [Role.OWNER],
    manage: [Role.OWNER],
  },
  stockMovements: {
    view: [Role.OWNER],
  },
  tenants: {
    view: [Role.OWNER],
    manage: [Role.OWNER],
  },
  users: {
    manage: [Role.OWNER],
  },
  activity: {
    view: [Role.OWNER],
  },
  dashboard: {
    view: [Role.OWNER],
  },
  reports: {
    // Current/low/out-of-stock: owner-only in the two-role model; there is
    // no non-owner operational role left to extend it to.
    stockLevels: [Role.OWNER],
    // Purchase history is owner-only; there is no separate purchasing role
    // to distinguish viewing from approving.
    purchaseHistory: [Role.OWNER],
    // Valuation and movement-velocity reports remain owner-only; there is
    // no separate audit role to carve out here either.
    financial: [Role.OWNER],
  },
  sales: {
    operate: [Role.OWNER, Role.CASHIER],
    return: [Role.OWNER, Role.CASHIER],
    viewAll: [Role.OWNER],
  },
  shifts: {
    operate: [Role.OWNER, Role.CASHIER],
    forceClose: [Role.OWNER],
    viewAll: [Role.OWNER],
  },
  customers: {
    manage: [Role.OWNER, Role.CASHIER],
  },
} as const;

export function roleAllowed(allowed: readonly Role[], role: Role): boolean {
  return allowed.includes(role);
}
