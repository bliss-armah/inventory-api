import { randomUUID } from "node:crypto";
import { prisma } from "../lib/prisma.ts";
import { signAccessToken, signPlatformAccessToken } from "../lib/jwt.ts";
import { hashPassword } from "../lib/password.ts";
import {
  Role,
  SubscriptionStatus,
  LocationType,
} from "../generated/prisma/enums.ts";

// A valid cost-12 bcrypt hash reused across fixtures — tests mint access
// tokens directly via signAccessToken() instead of logging in, so the real
// plaintext password is never needed and paying bcrypt's cost per fixture
// would just slow the suite down for no benefit.
const DUMMY_PASSWORD_HASH =
  "$2b$12$yzTYF9/dHlYsg2qkFGZ1wO6Rfhq3u24J4GOtT/D5PJPieZn0I/i4S";

/** The real, known plaintext behind createTenantWithRealPassword/createUserWithRealPassword. */
export const TEST_PASSWORD = "TestPassword123!";

// A random UUID rather than Date.now()-based uniqueness: timestamps only
// carry millisecond resolution, so fast successive fixture calls (or two
// test files racing) can plausibly generate the same value.
function unique(prefix: string): string {
  return `${prefix}-${randomUUID()}`;
}

export async function createTenantWithOwner(namePrefix = "Test Co") {
  const tenant = await prisma.tenant.create({
    data: {
      businessName: unique(namePrefix),
      phone: "+10000000000",
      email: `${unique("owner")}@example.test`,
      country: "Testland",
      timeZone: "UTC",
      subscriptionStatus: SubscriptionStatus.TRIALING,
    },
  });

  const user = await prisma.user.create({
    data: {
      tenantId: tenant.id,
      name: "Test Owner",
      email: `${unique("user")}@example.test`,
      passwordHash: DUMMY_PASSWORD_HASH,
      role: Role.OWNER,
    },
  });

  const token = signAccessToken({
    sub: user.id,
    tenantId: tenant.id,
    role: user.role,
  });
  return { tenant, user, token };
}

/**
 * Unlike createTenantWithOwner, this hashes a real known password so tests
 * can exercise the actual /api/auth/login endpoint (needed for anything
 * touching 2FA-gated login, since that logic lives in login() itself, not
 * something a directly-minted token can exercise).
 */
export async function createTenantWithOwnerAndPassword(namePrefix = "Test Co") {
  const passwordHash = await hashPassword(TEST_PASSWORD);
  const tenant = await prisma.tenant.create({
    data: {
      businessName: unique(namePrefix),
      phone: "+10000000000",
      email: `${unique("owner")}@example.test`,
      country: "Testland",
      timeZone: "UTC",
      subscriptionStatus: SubscriptionStatus.TRIALING,
    },
  });

  const user = await prisma.user.create({
    data: {
      tenantId: tenant.id,
      name: "Test Owner",
      email: `${unique("user")}@example.test`,
      passwordHash,
      role: Role.OWNER,
    },
  });

  return { tenant, user };
}

export async function createUserWithPassword(
  tenantId: string,
  role: Role,
  namePrefix = "Test User",
) {
  const passwordHash = await hashPassword(TEST_PASSWORD);
  const user = await prisma.user.create({
    data: {
      tenantId,
      name: namePrefix,
      email: `${unique("user")}@example.test`,
      passwordHash,
      role,
    },
  });
  return user;
}

export function createLocation(tenantId: string, name = "Main") {
  return prisma.location.create({
    data: { tenantId, name: unique(name), type: LocationType.MAIN_STORE },
  });
}

export function createProduct(tenantId: string, minimumStock = 0) {
  return prisma.product.create({
    data: {
      tenantId,
      sku: unique("SKU"),
      name: unique("Product"),
      unit: "unit",
      costPrice: 10,
      sellingPrice: 20,
      minimumStock,
    },
  });
}

/**
 * Deleting a Tenant cascades most child tables automatically, but Product
 * has intentionally Restrict (not Cascade) foreign keys from every
 * transactional table that references it — deleting a product out from
 * under its purchase/movement history is a real-world footgun the schema
 * guards against deliberately. So test cleanup has to clear those
 * transactional rows in dependency order before deleting products, and only
 * then delete the tenant for everything else to cascade normally.
 */
export async function deleteTenant(tenantId: string) {
  await prisma.saleReturnItem.deleteMany({ where: { tenantId } });
  await prisma.saleReturn.deleteMany({ where: { tenantId } });
  await prisma.saleItem.deleteMany({ where: { tenantId } });
  await prisma.sale.deleteMany({ where: { tenantId } });
  await prisma.shift.deleteMany({ where: { tenantId } });
  await prisma.goodsReceipt.deleteMany({ where: { tenantId } });
  await prisma.purchaseOrder.deleteMany({ where: { tenantId } });
  await prisma.stockTransfer.deleteMany({ where: { tenantId } });
  await prisma.stockCount.deleteMany({ where: { tenantId } });
  await prisma.stockAdjustment.deleteMany({ where: { tenantId } });
  await prisma.stockMovement.deleteMany({ where: { tenantId } });
  await prisma.inventory.deleteMany({ where: { tenantId } });
  await prisma.product.deleteMany({ where: { tenantId } });
  await prisma.tenant.delete({ where: { id: tenantId } });
}

export function createCashier(tenantId: string, namePrefix = "Test Cashier") {
  return createUserWithPassword(tenantId, Role.CASHIER, namePrefix);
}

export function tokenFor(user: { id: string; tenantId: string; role: Role }) {
  return signAccessToken({ sub: user.id, tenantId: user.tenantId, role: user.role });
}

/**
 * A platform admin oversees every tenant and authenticates against a separate
 * secret, so its token is minted by signPlatformAccessToken rather than
 * tokenFor — a tenant token is not merely unauthorised on platform routes, it
 * is unverifiable there, and vice versa.
 */
export async function createPlatformAdmin(namePrefix = "Test Platform Admin") {
  const admin = await prisma.platformAdmin.create({
    data: {
      name: namePrefix,
      email: `${unique("platform-admin")}@example.test`,
      passwordHash: DUMMY_PASSWORD_HASH,
    },
  });
  return { admin, token: signPlatformAccessToken({ sub: admin.id }) };
}

export async function deletePlatformAdmin(id: string) {
  await prisma.platformAdminRefreshToken.deleteMany({
    where: { platformAdminId: id },
  });
  await prisma.platformAdmin.delete({ where: { id } });
}

export function enablePos(tenantId: string, maxDiscountPercent = 0) {
  return prisma.businessSettings.upsert({
    where: { tenantId },
    create: { tenantId, enablePos: true, maxDiscountPercent },
    update: { enablePos: true, maxDiscountPercent },
  });
}

export function seedStock(
  tenantId: string,
  productId: string,
  locationId: string,
  quantity: number,
) {
  return prisma.inventory.create({
    data: { tenantId, productId, locationId, quantity },
  });
}
