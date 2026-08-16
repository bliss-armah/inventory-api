/**
 * Demo dataset: everything the app needs to look and behave like a business
 * that has actually been used — catalogue, stock on hand, and one worked
 * example of every stock-moving flow (purchase order → goods receipt,
 * transfer between locations, adjustment, stock count).
 *
 * Deliberately separate from seed.ts, which stays a minimal bootstrap fit for
 * a real deployment (one platform admin, one tenant, one owner). Run that
 * first; this builds on top of the tenant it creates.
 *
 * Everything that changes stock quantities goes through the service layer
 * rather than raw inserts, so `Inventory.quantity` always equals the sum of
 * its `StockMovement` rows and the dashboard/report figures reconcile. Writing
 * those rows by hand would let demo data drift out of agreement with movement
 * history, which reads as a bug in the app rather than bad fixtures. It also
 * means this file doubles as a smoke test of those services.
 *
 * Idempotent: every step looks for what it would create and skips if it's
 * already there, so re-running tops up a partial seed rather than duplicating
 * or failing.
 */
// Side-effect import: loads the single server/.env and derives DATABASE_URL
// before lib/prisma.ts reads it. The SEED_* vars below aren't part of the
// validated schema (nothing at runtime needs them), so they come from
// process.env, which this populates.
import "../src/config/env.ts";
import { prisma } from "../src/lib/prisma.ts";
import {
  InventoryMode,
  LocationType,
  MovementType,
  AdjustmentReason,
  Role,
} from "../src/generated/prisma/enums.ts";
import * as tenantsService from "../src/modules/tenants/tenants.service.ts";
import * as locationsService from "../src/modules/locations/locations.service.ts";
import * as usersService from "../src/modules/users/users.service.ts";
import * as categoriesService from "../src/modules/categories/categories.service.ts";
import * as brandsService from "../src/modules/brands/brands.service.ts";
import * as suppliersService from "../src/modules/suppliers/suppliers.service.ts";
import * as productsService from "../src/modules/products/products.service.ts";
import * as purchaseOrdersService from "../src/modules/purchase-orders/purchase-orders.service.ts";
import * as stockMovementsService from "../src/modules/stock-movements/stock-movements.service.ts";
import * as stockTransfersService from "../src/modules/stock-transfers/stock-transfers.service.ts";
import * as stockAdjustmentsService from "../src/modules/stock-adjustments/stock-adjustments.service.ts";
import * as stockCountsService from "../src/modules/stock-counts/stock-counts.service.ts";

const DEMO_PASSWORD = process.env.SEED_DEMO_STAFF_PASSWORD || "DemoStaff123!";

const CATEGORIES = ["Beverages", "Dry Goods", "Cleaning", "Packaging"];
const BRANDS = ["Voltic", "Nestlé", "Unilever", "Generic"];

const STAFF: Array<{ name: string; email: string; role: Role }> = [
  { name: "Ama Mensah", email: "cashier1@demo.local", role: Role.CASHIER },
  { name: "Kofi Boateng", email: "cashier2@demo.local", role: Role.CASHIER },
];

/**
 * `openingStock` is what gets booked in at the main store up front; the PO and
 * transfer flows below then move some of it around, so the closing numbers are
 * the result of real movements rather than a hardcoded figure.
 */
const PRODUCTS = [
  { sku: "BEV-500ML", name: "Bottled Water 500ml", category: "Beverages", brand: "Voltic", unit: "crate", costPrice: 18, sellingPrice: 25, minimumStock: 20, openingStock: 120 },
  { sku: "BEV-1_5L", name: "Bottled Water 1.5L", category: "Beverages", brand: "Voltic", unit: "crate", costPrice: 30, sellingPrice: 42, minimumStock: 15, openingStock: 80 },
  { sku: "BEV-MILO-400", name: "Milo Tin 400g", category: "Beverages", brand: "Nestlé", unit: "tin", costPrice: 35, sellingPrice: 48, minimumStock: 24, openingStock: 60 },
  { sku: "DRY-RICE-25", name: "Perfumed Rice 25kg", category: "Dry Goods", brand: "Generic", unit: "bag", costPrice: 480, sellingPrice: 560, minimumStock: 10, openingStock: 40 },
  { sku: "DRY-SUGAR-50", name: "Granulated Sugar 50kg", category: "Dry Goods", brand: "Generic", unit: "bag", costPrice: 520, sellingPrice: 610, minimumStock: 8, openingStock: 25 },
  { sku: "DRY-OIL-5L", name: "Vegetable Oil 5L", category: "Dry Goods", brand: "Generic", unit: "jerrycan", costPrice: 145, sellingPrice: 178, minimumStock: 12, openingStock: 36 },
  { sku: "CLN-OMO-1KG", name: "Detergent Powder 1kg", category: "Cleaning", brand: "Unilever", unit: "pack", costPrice: 22, sellingPrice: 31, minimumStock: 30, openingStock: 90 },
  { sku: "CLN-BLEACH-2L", name: "Bleach 2L", category: "Cleaning", brand: "Unilever", unit: "bottle", costPrice: 16, sellingPrice: 24, minimumStock: 25, openingStock: 70 },
  { sku: "PKG-BAG-MED", name: "Carrier Bags (Medium)", category: "Packaging", brand: "Generic", unit: "roll", costPrice: 12, sellingPrice: 19, minimumStock: 40, openingStock: 150 },
  // Starts below its minimum and stays there: the purchase order below orders
  // 100 but only 20 arrive, so this is simultaneously the partially-received
  // line and the product the low-stock report and dashboard alerts have to
  // show. Keep the received quantity under 38 or this stops being low stock.
  { sku: "PKG-TAPE-48", name: "Packing Tape 48mm", category: "Packaging", brand: "Generic", unit: "roll", costPrice: 9, sellingPrice: 15, minimumStock: 50, openingStock: 12 },
];

const SUPPLIERS = [
  { name: "Accra Wholesale Ltd", contactPerson: "Nana Adjei", phone: "+233302000111", email: "sales@accrawholesale.test", address: "Industrial Area, Accra" },
  { name: "Tema Distribution Co", contactPerson: "Esi Appiah", phone: "+233303000222", email: "orders@temadist.test", address: "Harbour Road, Tema" },
];

const WAREHOUSE_NAME = "Overflow Warehouse";

function log(step: string, detail: string) {
  console.log(`  ${step.padEnd(18)} ${detail}`);
}

/** Resolves the tenant seed.ts created, so this script never invents one. */
async function resolveTenant() {
  const email = (
    process.env.SEED_DEMO_OWNER_EMAIL || "owner@demo.local"
  ).toLowerCase();
  const owner = await prisma.user.findUnique({ where: { email } });
  if (!owner) {
    throw new Error(
      `No demo tenant found for ${email}. Run \`npm run db:seed\` first — this script builds on the tenant it creates.`,
    );
  }
  return { tenantId: owner.tenantId, ownerId: owner.id };
}

async function ensureMultiLocation(tenantId: string, ownerId: string) {
  const settings = await prisma.businessSettings.findUniqueOrThrow({
    where: { tenantId },
  });
  if (settings.inventoryMode === InventoryMode.MULTIPLE_LOCATIONS) {
    log("settings", "already in multi-location mode");
    return;
  }
  // locations.service.create refuses a second location in single-location
  // mode, so this has to happen before the warehouse is added — and it's what
  // a real business would do first too.
  await tenantsService.updateSettings(tenantId, ownerId, {
    inventoryMode: InventoryMode.MULTIPLE_LOCATIONS,
    enableBatchTracking: true,
    enableExpiryTracking: true,
  });
  log("settings", "switched to multi-location, batch + expiry tracking on");
}

async function ensureLocations(tenantId: string, ownerId: string) {
  await ensureMultiLocation(tenantId, ownerId);

  const main = await prisma.location.findFirst({
    where: { tenantId, isDefault: true },
  });
  if (!main) {
    throw new Error("Demo tenant has no default location — was db:seed modified?");
  }

  let warehouse = await prisma.location.findFirst({
    where: { tenantId, name: WAREHOUSE_NAME },
  });
  if (warehouse) {
    log("locations", `${main.name} + ${warehouse.name} (existing)`);
  } else {
    warehouse = await locationsService.create(tenantId, {
      name: WAREHOUSE_NAME,
      type: LocationType.WAREHOUSE,
      address: "Spintex Road, Accra",
      description: "Bulk storage for slow-moving stock",
    });
    log("locations", `created ${warehouse.name}`);
  }

  return { main, warehouse };
}

async function ensureStaff(tenantId: string) {
  let created = 0;
  for (const member of STAFF) {
    const existing = await prisma.user.findUnique({
      where: { email: member.email },
    });
    if (existing) continue;
    await usersService.create(tenantId, { ...member, password: DEMO_PASSWORD });
    created += 1;
  }
  log("staff", `${created} created, ${STAFF.length - created} already present`);
}

async function ensureReferenceData(tenantId: string) {
  const categories = new Map<string, string>();
  for (const name of CATEGORIES) {
    const existing = await prisma.category.findFirst({ where: { tenantId, name } });
    const row = existing ?? (await categoriesService.create(tenantId, { name }));
    categories.set(name, row.id);
  }

  const brands = new Map<string, string>();
  for (const name of BRANDS) {
    const existing = await prisma.brand.findFirst({ where: { tenantId, name } });
    const row = existing ?? (await brandsService.create(tenantId, { name }));
    brands.set(name, row.id);
  }

  const suppliers: string[] = [];
  for (const supplier of SUPPLIERS) {
    const existing = await prisma.supplier.findFirst({
      where: { tenantId, name: supplier.name },
    });
    const row = existing ?? (await suppliersService.create(tenantId, supplier));
    suppliers.push(row.id);
  }

  log(
    "reference",
    `${categories.size} categories, ${brands.size} brands, ${suppliers.length} suppliers`,
  );
  return { categories, brands, suppliers };
}

async function ensureProducts(
  tenantId: string,
  categories: Map<string, string>,
  brands: Map<string, string>,
) {
  const products = new Map<string, { id: string; openingStock: number; costPrice: number }>();
  let created = 0;

  for (const spec of PRODUCTS) {
    const existing = await prisma.product.findFirst({
      where: { tenantId, sku: spec.sku },
    });
    const row =
      existing ??
      (await productsService.create(tenantId, {
        sku: spec.sku,
        name: spec.name,
        unit: spec.unit,
        costPrice: spec.costPrice,
        sellingPrice: spec.sellingPrice,
        minimumStock: spec.minimumStock,
        categoryId: categories.get(spec.category),
        brandId: brands.get(spec.brand),
      }));
    if (!existing) created += 1;
    products.set(spec.sku, {
      id: row.id,
      openingStock: spec.openingStock,
      costPrice: spec.costPrice,
    });
  }

  log("products", `${created} created, ${PRODUCTS.length - created} already present`);
  return products;
}

/**
 * Books opening stock as PURCHASE movements at the main store. Skipped per
 * product if any movement already exists for it, so a re-run doesn't double
 * the quantities.
 */
async function ensureOpeningStock(
  tenantId: string,
  ownerId: string,
  mainLocationId: string,
  products: Map<string, { id: string; openingStock: number }>,
) {
  let booked = 0;
  for (const [sku, product] of products) {
    const existing = await prisma.stockMovement.findFirst({
      where: { tenantId, productId: product.id },
    });
    if (existing) continue;

    await stockMovementsService.recordMovementStandalone({
      tenantId,
      productId: product.id,
      locationId: mainLocationId,
      userId: ownerId,
      type: MovementType.PURCHASE,
      quantity: product.openingStock,
      reference: "OPENING",
      notes: `Opening stock for ${sku}`,
    });
    booked += 1;
  }
  log("opening stock", `${booked} products booked in at the main store`);
}

/**
 * The full purchasing chain, exactly as the app would drive it: draft →
 * submitted → approved → goods received. The receipt is deliberately partial
 * on one line so the PO lands in GOODS_RECEIVED rather than COMPLETED, giving
 * the UI an order with outstanding quantity to display.
 */
async function ensurePurchaseOrder(
  tenantId: string,
  ownerId: string,
  locationId: string,
  supplierId: string,
  products: Map<string, { id: string; costPrice: number }>,
) {
  const existing = await prisma.purchaseOrder.findFirst({ where: { tenantId } });
  if (existing) {
    log("purchase order", `already present (${existing.orderNumber})`);
    return;
  }

  const rice = products.get("DRY-RICE-25")!;
  const sugar = products.get("DRY-SUGAR-50")!;
  const tape = products.get("PKG-TAPE-48")!;

  const order = await purchaseOrdersService.create(tenantId, ownerId, {
    supplierId,
    locationId,
    notes: "Monthly restock",
    items: [
      { productId: rice.id, quantityOrdered: 20, costPrice: rice.costPrice },
      { productId: sugar.id, quantityOrdered: 15, costPrice: sugar.costPrice },
      { productId: tape.id, quantityOrdered: 100, costPrice: tape.costPrice },
    ],
  });

  await purchaseOrdersService.submit(tenantId, order.id);
  await purchaseOrdersService.approve(tenantId, ownerId, order.id);
  await purchaseOrdersService.receiveGoods(tenantId, ownerId, order.id, {
    notes: "First delivery — tape short-shipped",
    items: [
      { productId: rice.id, quantity: 20, costPrice: rice.costPrice },
      { productId: sugar.id, quantity: 15, costPrice: sugar.costPrice },
      // Short by 80 on purpose: leaves the order partially received *and*
      // leaves the tape below its minimum stock (12 + 20 = 32 against a
      // minimum of 50), so low-stock reporting has a real row to show.
      { productId: tape.id, quantity: 20, costPrice: tape.costPrice },
    ],
  });

  log("purchase order", `${order.orderNumber} received (tape partially)`);
}

/** Transfer main → warehouse, walked all the way to RECEIVED. */
async function ensureTransfer(
  tenantId: string,
  ownerId: string,
  fromLocationId: string,
  toLocationId: string,
  products: Map<string, { id: string }>,
) {
  const existing = await prisma.stockTransfer.findFirst({ where: { tenantId } });
  if (existing) {
    log("transfer", "already present");
    return;
  }

  const water = products.get("BEV-500ML")!;
  const bags = products.get("PKG-BAG-MED")!;

  const transfer = await stockTransfersService.create(tenantId, ownerId, {
    fromLocationId,
    toLocationId,
    notes: "Move slow-moving bulk to the warehouse",
    items: [
      { productId: water.id, quantity: 30 },
      { productId: bags.id, quantity: 50 },
    ],
  });

  await stockTransfersService.approve(tenantId, ownerId, transfer.id);
  await stockTransfersService.dispatch(tenantId, ownerId, transfer.id);
  await stockTransfersService.receive(tenantId, ownerId, transfer.id);

  log("transfer", "2 lines moved to the warehouse and received");
}

async function ensureAdjustment(
  tenantId: string,
  ownerId: string,
  locationId: string,
  products: Map<string, { id: string }>,
) {
  const existing = await prisma.stockAdjustment.findFirst({ where: { tenantId } });
  if (existing) {
    log("adjustment", "already present");
    return;
  }

  await stockAdjustmentsService.create(tenantId, ownerId, {
    productId: products.get("CLN-BLEACH-2L")!.id,
    locationId,
    quantity: -4,
    reason: AdjustmentReason.DAMAGE,
    notes: "Four bottles split in transit",
  });
  log("adjustment", "-4 bleach written off as damaged");
}

/**
 * A completed stock count whose physical figures differ from the system's on
 * two lines — completing it posts the correcting ADJUSTMENT movements, which
 * is the behaviour worth having demo data for.
 */
async function ensureStockCount(
  tenantId: string,
  ownerId: string,
  locationId: string,
  products: Map<string, { id: string }>,
) {
  const existing = await prisma.stockCount.findFirst({ where: { tenantId } });
  if (existing) {
    log("stock count", "already present");
    return;
  }

  const count = await stockCountsService.create(tenantId, ownerId, {
    locationId,
    notes: "Month-end count — cleaning aisle",
  });

  const detergent = products.get("CLN-OMO-1KG")!;
  const milo = products.get("BEV-MILO-400")!;
  const onHand = await prisma.inventory.findMany({
    where: { tenantId, locationId, productId: { in: [detergent.id, milo.id] } },
    select: { productId: true, quantity: true },
  });
  const quantityOf = (productId: string) =>
    onHand.find((row) => row.productId === productId)?.quantity ?? 0;

  await stockCountsService.updateItems(tenantId, count.id, {
    items: [
      // Two short, one over — a realistic count, not a clean match.
      { productId: detergent.id, physicalQuantity: Math.max(0, quantityOf(detergent.id) - 2) },
      { productId: milo.id, physicalQuantity: quantityOf(milo.id) + 1 },
    ],
  });
  await stockCountsService.complete(tenantId, ownerId, count.id);

  log("stock count", "completed with 2 variances posted");
}

/**
 * The invariant that justifies routing all of this through the services: every
 * inventory row must equal the sum of its movements. A mismatch means demo data
 * would contradict the movement history the reports are built from.
 */
async function verifyConsistency(tenantId: string) {
  const rows = await prisma.$queryRaw<
    Array<{ productId: string; locationId: string; quantity: number; movementSum: number }>
  >`
    SELECT i."productId", i."locationId", i.quantity::int AS "quantity",
           COALESCE(SUM(m.quantity), 0)::int AS "movementSum"
      FROM "inventory" i
      LEFT JOIN "stock_movements" m
        ON m."productId" = i."productId" AND m."locationId" = i."locationId"
     WHERE i."tenantId" = ${tenantId}
     GROUP BY i."productId", i."locationId", i.quantity
    HAVING i.quantity <> COALESCE(SUM(m.quantity), 0)::int
  `;

  if (rows.length > 0) {
    throw new Error(
      `Inventory disagrees with movement history on ${rows.length} row(s) — refusing to report success. First: ${JSON.stringify(rows[0])}`,
    );
  }
  log("consistency", "every inventory row matches the sum of its movements");
}

async function summarize(tenantId: string) {
  const [
    locations, users, categories, brands, suppliers, products,
    inventory, movements, orders, receipts, adjustments, transfers, counts,
  ] = await Promise.all([
    prisma.location.count({ where: { tenantId } }),
    prisma.user.count({ where: { tenantId } }),
    prisma.category.count({ where: { tenantId } }),
    prisma.brand.count({ where: { tenantId } }),
    prisma.supplier.count({ where: { tenantId } }),
    prisma.product.count({ where: { tenantId } }),
    prisma.inventory.count({ where: { tenantId } }),
    prisma.stockMovement.count({ where: { tenantId } }),
    prisma.purchaseOrder.count({ where: { tenantId } }),
    prisma.goodsReceipt.count({ where: { tenantId } }),
    prisma.stockAdjustment.count({ where: { tenantId } }),
    prisma.stockTransfer.count({ where: { tenantId } }),
    prisma.stockCount.count({ where: { tenantId } }),
  ]);

  console.log("");
  console.log("=========================================");
  console.log(" Demo data ready");
  console.log("=========================================");
  for (const [label, value] of [
    ["locations", locations], ["users", users], ["categories", categories],
    ["brands", brands], ["suppliers", suppliers], ["products", products],
    ["inventory rows", inventory], ["stock movements", movements],
    ["purchase orders", orders], ["goods receipts", receipts],
    ["adjustments", adjustments], ["transfers", transfers], ["stock counts", counts],
  ] as Array<[string, number]>) {
    console.log(` ${label.padEnd(18)} ${value}`);
  }
  console.log("=========================================");
  console.log(` Staff logins: ${STAFF.map((s) => s.email).join(", ")}`);
  console.log(` Staff password: ${DEMO_PASSWORD}`);
  console.log("=========================================");
  console.log("");
}

async function main() {
  const { tenantId, ownerId } = await resolveTenant();
  console.log("Seeding demo data...");

  const { main, warehouse } = await ensureLocations(tenantId, ownerId);
  await ensureStaff(tenantId);
  const { categories, brands, suppliers } = await ensureReferenceData(tenantId);
  const products = await ensureProducts(tenantId, categories, brands);

  await ensureOpeningStock(tenantId, ownerId, main.id, products);
  await ensurePurchaseOrder(tenantId, ownerId, main.id, suppliers[0]!, products);
  await ensureTransfer(tenantId, ownerId, main.id, warehouse.id, products);
  await ensureAdjustment(tenantId, ownerId, main.id, products);
  await ensureStockCount(tenantId, ownerId, main.id, products);

  await verifyConsistency(tenantId);
  await summarize(tenantId);
}

main()
  .catch((error) => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
