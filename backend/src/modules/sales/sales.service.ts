import { Prisma } from "../../generated/prisma/client.ts";
import { MovementType, Role } from "../../generated/prisma/enums.ts";
import { prisma } from "../../lib/prisma.ts";
import { logActivity } from "../../lib/activity-logger.ts";
import { BadRequestError, ConflictError, NotFoundError } from "../../shared/errors.ts";
import { assertOwned } from "../../shared/ownership.ts";
import { paginate } from "../../shared/pagination.ts";
import { PERMISSIONS, roleAllowed } from "../../shared/permissions.ts";
import { recordMovement } from "../stock-movements/stock-movements.service.ts";
import { assertOpenShift, assertShiftStillOpen } from "../shifts/shifts.service.ts";
import { computeSaleTotals, assertWithinDiscountCap } from "./sales.money.ts";
import * as salesRepository from "./sales.repository.ts";
import type { CreateSaleInput } from "./sales.validators.ts";

export async function create(
  tenantId: string,
  userId: string,
  input: CreateSaleInput,
) {
  const existing = await salesRepository.findById(tenantId, input.id);
  if (existing) {
    return { sale: existing, alreadyExisted: true };
  }

  const shift = await assertOpenShift(tenantId, userId, input.shiftId);

  await assertOwned(tenantId, {
    productIds: input.items.map((item) => item.productId),
    locationIds: [shift.locationId],
  });

  if (input.customerId) {
    const customer = await prisma.customer.findFirst({
      where: { tenantId, id: input.customerId },
      select: { id: true },
    });
    if (!customer) {
      throw new BadRequestError("That customer does not belong to this business");
    }
  }

  const products = await prisma.product.findMany({
    where: { tenantId, id: { in: input.items.map((item) => item.productId) } },
    select: { id: true, costPrice: true, sellingPrice: true },
  });
  const productById = new Map(products.map((product) => [product.id, product]));

  const items = input.items.map((item) => ({
    ...item,
    unitPrice: new Prisma.Decimal(item.unitPrice),
    discountAmount: new Prisma.Decimal(item.discountAmount),
  }));

  const totals = computeSaleTotals({
    items,
    discountAmount: new Prisma.Decimal(input.discountAmount),
  });

  const settings = await prisma.businessSettings.findUnique({
    where: { tenantId },
    select: { maxDiscountPercent: true },
  });
  const cap = settings?.maxDiscountPercent ?? new Prisma.Decimal(0);

  assertWithinDiscountCap(totals, cap);

  const priceDiscrepancy = items.some((item) => {
    const product = productById.get(item.productId);
    return product ? !product.sellingPrice.equals(item.unitPrice) : false;
  });

  const amountTendered = new Prisma.Decimal(input.amountTendered);
  if (amountTendered.lessThan(totals.total)) {
    throw new BadRequestError("Amount tendered is less than the sale total");
  }

  try {
    const newSale = await prisma.$transaction(async (tx) => {
      await assertShiftStillOpen(tx, tenantId, shift.id);

      const sale = await salesRepository.createSale(tx, {
        id: input.id,
        tenantId,
        saleNumber: input.saleNumber,
        locationId: shift.locationId,
        shiftId: shift.id,
        cashierId: userId,
        customerId: input.customerId ?? null,
        subtotal: totals.subtotal,
        discountAmount: new Prisma.Decimal(input.discountAmount),
        discountReason: input.discountReason ?? null,
        total: totals.total,
        paymentMethod: input.paymentMethod,
        amountTendered,
        changeGiven: amountTendered.minus(totals.total),
        priceDiscrepancy,
        soldAt: input.soldAt,
      });

      await salesRepository.createItems(
        tx,
        items.map((item, index) => {
          const product = productById.get(item.productId);
          if (!product) {
            throw new BadRequestError(`Product ${item.productId} is no longer available`);
          }
          const lineTotal = totals.lineTotals[index];
          if (!lineTotal) {
            throw new BadRequestError(`Missing line total for product ${item.productId}`);
          }
          return {
            tenantId,
            saleId: sale.id,
            productId: item.productId,
            quantity: item.quantity,
            unitPrice: item.unitPrice,
            unitCost: product.costPrice,
            discountAmount: item.discountAmount,
            lineTotal,
          };
        }),
      );

      for (const item of items) {
        await recordMovement(tx, {
          tenantId,
          productId: item.productId,
          locationId: shift.locationId,
          userId,
          type: MovementType.SALE,
          quantity: item.quantity,
          reference: sale.saleNumber,
        });
      }

      await logActivity(
        {
          tenantId,
          userId,
          action: "SALE_RECORDED",
          description: `Sale ${sale.saleNumber} for ${totals.total}`,
        },
        tx,
      );

      return { sale, alreadyExisted: false };
    });

    const fullSale = await salesRepository.findById(tenantId, newSale.sale.id);
    if (!fullSale) {
      throw new NotFoundError("Sale was created but could not be found");
    }
    return { sale: fullSale, alreadyExisted: false };
  } catch (error) {
    if (
      error instanceof Prisma.PrismaClientKnownRequestError &&
      error.code === "P2002"
    ) {
      const committed = await salesRepository.findById(tenantId, input.id);
      if (committed) {
        return { sale: committed, alreadyExisted: true };
      }
      throw new ConflictError(`Sale number ${input.saleNumber} is already in use`);
    }
    throw error;
  }
}

export async function get(tenantId: string, userId: string, role: Role, id: string) {
  const sale = await salesRepository.findById(tenantId, id);
  if (!sale) {
    throw new NotFoundError("Sale not found");
  }

  const canViewAll = roleAllowed(PERMISSIONS.sales.viewAll, role);
  if (!canViewAll && sale.cashierId !== userId) {
    throw new NotFoundError("Sale not found");
  }
  if (canViewAll) {
    return sale;
  }

  return {
    ...sale,
    items: sale.items.map((item) => ({
      id: item.id,
      tenantId: item.tenantId,
      saleId: item.saleId,
      productId: item.productId,
      quantity: item.quantity,
      unitPrice: item.unitPrice,
      discountAmount: item.discountAmount,
      lineTotal: item.lineTotal,
      product: item.product,
    })),
  };
}

export function list(tenantId: string, userId: string, role: Role, rawQuery: unknown) {
  const cashierId = roleAllowed(PERMISSIONS.sales.viewAll, role) ? undefined : userId;
  return paginate(rawQuery, (skip, take) =>
    salesRepository.list(tenantId, skip, take, { cashierId }),
  );
}

export async function catalog(tenantId: string, locationId: string) {
  await assertOwned(tenantId, { locationIds: [locationId] });
  return salesRepository.catalog(tenantId, locationId);
}
