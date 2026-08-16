import { Prisma } from "../../generated/prisma/client.ts";
import { BadRequestError } from "../../shared/errors.ts";

export type SaleTotalsInput = {
  items: Array<{
    quantity: number;
    unitPrice: Prisma.Decimal;
    discountAmount: Prisma.Decimal;
  }>;
  discountAmount: Prisma.Decimal;
};

export type SaleTotals = {
  lineTotals: Prisma.Decimal[];
  lineGross: Prisma.Decimal[];
  subtotal: Prisma.Decimal;
  total: Prisma.Decimal;
  totalDiscount: Prisma.Decimal;
  gross: Prisma.Decimal;
};

const ZERO = new Prisma.Decimal(0);

export function computeSaleTotals(input: SaleTotalsInput): SaleTotals {
  const lineGross: Prisma.Decimal[] = [];
  const lineTotals: Prisma.Decimal[] = [];

  for (const item of input.items) {
    const gross = item.unitPrice.times(item.quantity);
    if (item.discountAmount.lessThan(ZERO)) {
      throw new BadRequestError("A line discount cannot be negative");
    }
    if (item.discountAmount.greaterThan(gross)) {
      throw new BadRequestError("A line discount cannot exceed the line total");
    }
    lineGross.push(gross);
    lineTotals.push(gross.minus(item.discountAmount));
  }

  const subtotal = lineTotals.reduce((sum, value) => sum.plus(value), ZERO);

  if (input.discountAmount.lessThan(ZERO)) {
    throw new BadRequestError("A sale discount cannot be negative");
  }
  if (input.discountAmount.greaterThan(subtotal)) {
    throw new BadRequestError("A sale discount cannot exceed the sale subtotal");
  }

  const lineDiscounts = input.items.reduce(
    (sum, item) => sum.plus(item.discountAmount),
    ZERO,
  );

  return {
    lineGross,
    lineTotals,
    subtotal,
    total: subtotal.minus(input.discountAmount),
    totalDiscount: lineDiscounts.plus(input.discountAmount),
    gross: lineGross.reduce((sum, value) => sum.plus(value), ZERO),
  };
}

export function assertWithinDiscountCap(
  totals: SaleTotals,
  maxDiscountPercent: Prisma.Decimal,
): void {
  if (totals.totalDiscount.equals(ZERO)) {
    return;
  }

  if (maxDiscountPercent.lessThanOrEqualTo(ZERO)) {
    throw new BadRequestError("Discounts are not enabled for this business");
  }

  const cap = maxDiscountPercent.dividedBy(100);

  if (totals.gross.greaterThan(ZERO)) {
    const overall = totals.totalDiscount.dividedBy(totals.gross);
    if (overall.greaterThan(cap)) {
      throw new BadRequestError(
        `Total discount exceeds the ${maxDiscountPercent}% limit`,
      );
    }
  }

  totals.lineGross.forEach((gross, index) => {
    const lineTotal = totals.lineTotals[index];
    if (!lineTotal || gross.lessThanOrEqualTo(ZERO)) return;
    const lineDiscount = gross.minus(lineTotal);
    if (lineDiscount.dividedBy(gross).greaterThan(cap)) {
      throw new BadRequestError(
        `A line discount exceeds the ${maxDiscountPercent}% limit`,
      );
    }
  });
}
