import { describe, expect, it } from "vitest";
import { Prisma } from "../generated/prisma/client";
import { computeSaleTotals, assertWithinDiscountCap } from "../modules/sales/sales.money";

const D = (value: string) => new Prisma.Decimal(value);

describe("computeSaleTotals", () => {
  it("sums line totals net of line discounts, then applies the sale discount", () => {
    const totals = computeSaleTotals({
      items: [
        { quantity: 2, unitPrice: D("10.50"), discountAmount: D("1.00") },
        { quantity: 1, unitPrice: D("5.25"), discountAmount: D("0") },
      ],
      discountAmount: D("2.00"),
    });

    expect(totals.subtotal.toFixed(2)).toBe("25.25");
    expect(totals.total.toFixed(2)).toBe("23.25");
    expect(totals.lineTotals[0]?.toFixed(2)).toBe("20.00");
  });

  it("rejects a discount that exceeds the line's own gross", () => {
    expect(() =>
      computeSaleTotals({
        items: [{ quantity: 1, unitPrice: D("10.00"), discountAmount: D("11.00") }],
        discountAmount: D("0"),
      }),
    ).toThrow(/discount/i);
  });
});

describe("assertWithinDiscountCap", () => {
  const totals = computeSaleTotals({
    items: [{ quantity: 1, unitPrice: D("100.00"), discountAmount: D("5.00") }],
    discountAmount: D("0"),
  });

  it("permits a discount at exactly the cap", () => {
    expect(() => assertWithinDiscountCap(totals, D("5"))).not.toThrow();
  });

  it("rejects a discount above the cap", () => {
    expect(() => assertWithinDiscountCap(totals, D("4"))).toThrow(/discount/i);
  });

  it("rejects any discount when the cap is zero", () => {
    expect(() => assertWithinDiscountCap(totals, D("0"))).toThrow(/discount/i);
  });

  it("catches a line over the cap even when the basket total stays under it", () => {
    const mixed = computeSaleTotals({
      items: [
        { quantity: 1, unitPrice: D("100.00"), discountAmount: D("100.00") },
        { quantity: 1, unitPrice: D("900.00"), discountAmount: D("0") },
      ],
      discountAmount: D("0"),
    });
    expect(() => assertWithinDiscountCap(mixed, D("15"))).toThrow(/discount/i);
  });
});
