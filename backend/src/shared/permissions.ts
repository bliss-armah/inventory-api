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
    manage: [Role.OWNER, Role.INVENTORY_MANAGER],
  },
  brands: {
    manage: [Role.OWNER, Role.INVENTORY_MANAGER],
  },
  suppliers: {
    manage: [Role.OWNER, Role.INVENTORY_MANAGER, Role.PURCHASING_OFFICER],
  },
  locations: {
    manage: [Role.OWNER, Role.INVENTORY_MANAGER],
  },
  products: {
    manage: [Role.OWNER, Role.INVENTORY_MANAGER],
  },
  stockAdjustments: {
    create: [Role.OWNER, Role.INVENTORY_MANAGER, Role.STOREKEEPER],
  },
  purchaseOrders: {
    create: [Role.OWNER, Role.PURCHASING_OFFICER],
    submit: [Role.OWNER, Role.PURCHASING_OFFICER],
    approve: [Role.OWNER, Role.INVENTORY_MANAGER],
    cancel: [Role.OWNER, Role.PURCHASING_OFFICER],
    receive: [Role.OWNER, Role.INVENTORY_MANAGER, Role.STOREKEEPER],
  },
  stockTransfers: {
    manage: [Role.OWNER, Role.INVENTORY_MANAGER, Role.STOREKEEPER],
  },
  stockCounts: {
    manage: [Role.OWNER, Role.INVENTORY_MANAGER, Role.STOREKEEPER],
  },
  tenants: {
    manage: [Role.OWNER],
  },
  users: {
    manage: [Role.OWNER],
  },
  activity: {
    view: [Role.OWNER, Role.AUDITOR],
  },
  reports: {
    // Current/low/out-of-stock: operationally relevant to whoever handles
    // physical stock, not just management/finance.
    stockLevels: [Role.OWNER, Role.INVENTORY_MANAGER, Role.AUDITOR, Role.STOREKEEPER],
    // Purchasing needs to see what's been bought before, not just approve it.
    purchaseHistory: [Role.OWNER, Role.INVENTORY_MANAGER, Role.AUDITOR, Role.PURCHASING_OFFICER],
    // Valuation and movement-velocity reports are financial/strategic —
    // kept to the original management/audit set.
    financial: [Role.OWNER, Role.INVENTORY_MANAGER, Role.AUDITOR],
  },
  sales: {
    operate: [Role.OWNER, Role.CASHIER],
    return: [Role.OWNER, Role.CASHIER],
    viewAll: [Role.OWNER, Role.INVENTORY_MANAGER, Role.AUDITOR],
  },
  shifts: {
    operate: [Role.OWNER, Role.CASHIER],
    forceClose: [Role.OWNER],
    viewAll: [Role.OWNER, Role.INVENTORY_MANAGER, Role.AUDITOR],
  },
  customers: {
    manage: [Role.OWNER, Role.INVENTORY_MANAGER, Role.CASHIER],
  },
} as const;

export function roleAllowed(allowed: readonly Role[], role: Role): boolean {
  return allowed.includes(role);
}
