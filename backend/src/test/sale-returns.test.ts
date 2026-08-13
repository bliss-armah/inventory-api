import { afterAll, beforeAll, describe, expect, it } from "vitest";
import request from "supertest";
import { randomUUID } from "node:crypto";
import { app } from "../app";
import { prisma } from "../lib/prisma";
import {
  createTenantWithOwner,
  createLocation,
  createProduct,
  createCashier,
  tokenFor,
  deleteTenant,
  enablePos,
  seedStock,
} from "./fixtures";

describe("sale returns", () => {
  let tenant: Awaited<ReturnType<typeof createTenantWithOwner>>;
  let location: Awaited<ReturnType<typeof createLocation>>;
  let cashierToken: string;
  let shiftId: string;

  beforeAll(async () => {
    tenant = await createTenantWithOwner("Returns Co");
    location = await createLocation(tenant.tenant.id);
    await enablePos(tenant.tenant.id);

    const cashier = await createCashier(tenant.tenant.id);
    cashierToken = tokenFor(cashier);

    const shiftRes = await request(app)
      .post("/api/shifts")
      .set("Authorization", `Bearer ${cashierToken}`)
      .send({ locationId: location.id, openingFloat: "0.00" });
    shiftId = shiftRes.body.data.id;
  });

  afterAll(async () => {
    await deleteTenant(tenant.tenant.id);
  });

  async function sellFive() {
    const product = await createProduct(tenant.tenant.id);
    await seedStock(tenant.tenant.id, product.id, location.id, 20);

    const res = await request(app)
      .post("/api/sales")
      .set("Authorization", `Bearer ${cashierToken}`)
      .send({
        id: randomUUID(),
        saleNumber: `SL-${randomUUID().slice(0, 12).toUpperCase()}`,
        shiftId,
        soldAt: new Date().toISOString(),
        paymentMethod: "CASH",
        amountTendered: "1000.00",
        items: [{ productId: product.id, quantity: 5, unitPrice: "20.00" }],
      });

    const sale = await prisma.sale.findUnique({
      where: { id: res.body.data.id },
      include: { items: true },
    });
    if (!sale) {
      throw new Error("Expected sale to exist after creation");
    }
    const saleItem = sale.items[0];
    if (!saleItem) {
      throw new Error("Expected sale to have at least one item");
    }
    return { product, sale, saleItem };
  }

  it("restocks a resalable return", async () => {
    const { product, sale, saleItem } = await sellFive();

    const res = await request(app)
      .post(`/api/sales/${sale.id}/returns`)
      .set("Authorization", `Bearer ${cashierToken}`)
      .send({
        shiftId,
        refundMethod: "CASH",
        items: [{ saleItemId: saleItem.id, quantity: 2, disposition: "RESTOCK" }],
      });

    expect(res.status).toBe(201);
    expect(Number(res.body.data.refundAmount)).toBe(40);

    const inventory = await prisma.inventory.findUnique({
      where: { productId_locationId: { productId: product.id, locationId: location.id } },
    });
    expect(inventory?.quantity).toBe(17);
  });

  it("nets to zero for a damaged return while recording both movements", async () => {
    const { product, sale, saleItem } = await sellFive();

    const res = await request(app)
      .post(`/api/sales/${sale.id}/returns`)
      .set("Authorization", `Bearer ${cashierToken}`)
      .send({
        shiftId,
        refundMethod: "CASH",
        items: [{ saleItemId: saleItem.id, quantity: 2, disposition: "DAMAGED" }],
      });

    expect(res.status).toBe(201);

    const inventory = await prisma.inventory.findUnique({
      where: { productId_locationId: { productId: product.id, locationId: location.id } },
    });
    expect(inventory?.quantity).toBe(15);

    expect(
      await prisma.stockMovement.count({ where: { productId: product.id, type: "RETURN" } }),
    ).toBe(1);
    expect(
      await prisma.stockMovement.count({ where: { productId: product.id, type: "DAMAGE" } }),
    ).toBe(1);
  });

  it("rejects returning more than was sold, across several returns", async () => {
    const { sale, saleItem } = await sellFive();

    const first = await request(app)
      .post(`/api/sales/${sale.id}/returns`)
      .set("Authorization", `Bearer ${cashierToken}`)
      .send({
        shiftId,
        refundMethod: "CASH",
        items: [{ saleItemId: saleItem.id, quantity: 4, disposition: "RESTOCK" }],
      });
    expect(first.status).toBe(201);

    const second = await request(app)
      .post(`/api/sales/${sale.id}/returns`)
      .set("Authorization", `Bearer ${cashierToken}`)
      .send({
        shiftId,
        refundMethod: "CASH",
        items: [{ saleItemId: saleItem.id, quantity: 2, disposition: "RESTOCK" }],
      });
    expect(second.status).toBe(400);
  });

  it("does not let concurrent returns jointly exceed what was sold", async () => {
    const { sale, saleItem } = await sellFive();

    const responses = await Promise.all(
      Array.from({ length: 3 }, () =>
        request(app)
          .post(`/api/sales/${sale.id}/returns`)
          .set("Authorization", `Bearer ${cashierToken}`)
          .send({
            shiftId,
            refundMethod: "CASH",
            items: [{ saleItemId: saleItem.id, quantity: 3, disposition: "RESTOCK" }],
          }),
      ),
    );

    expect(responses.filter((res) => res.status === 201)).toHaveLength(1);

    const totalReturned = await prisma.saleReturnItem.aggregate({
      where: { saleItemId: saleItem.id },
      _sum: { quantity: true },
    });
    expect(totalReturned._sum.quantity).toBe(3);
  });

  it("rejects duplicate lines for the same item in one request that jointly exceed what was sold, but accepts them when they do not", async () => {
    const { product, sale, saleItem } = await sellFive();

    const overReturn = await request(app)
      .post(`/api/sales/${sale.id}/returns`)
      .set("Authorization", `Bearer ${cashierToken}`)
      .send({
        shiftId,
        refundMethod: "CASH",
        items: [
          { saleItemId: saleItem.id, quantity: 3, disposition: "RESTOCK" },
          { saleItemId: saleItem.id, quantity: 3, disposition: "DAMAGED" },
        ],
      });
    expect(overReturn.status).toBe(400);
    expect(await prisma.saleReturn.count({ where: { saleId: sale.id } })).toBe(0);

    const inventory = await prisma.inventory.findUnique({
      where: { productId_locationId: { productId: product.id, locationId: location.id } },
    });
    expect(inventory?.quantity).toBe(15);

    const mixed = await request(app)
      .post(`/api/sales/${sale.id}/returns`)
      .set("Authorization", `Bearer ${cashierToken}`)
      .send({
        shiftId,
        refundMethod: "CASH",
        items: [
          { saleItemId: saleItem.id, quantity: 2, disposition: "RESTOCK" },
          { saleItemId: saleItem.id, quantity: 1, disposition: "DAMAGED" },
        ],
      });
    expect(mixed.status).toBe(201);

    const totalReturned = await prisma.saleReturnItem.aggregate({
      where: { saleItemId: saleItem.id },
      _sum: { quantity: true },
    });
    expect(totalReturned._sum.quantity).toBe(3);
  });

  it("sums exactly to the line total across partial returns that do not divide evenly", async () => {
    await enablePos(tenant.tenant.id, 50);

    const product = await createProduct(tenant.tenant.id);
    await seedStock(tenant.tenant.id, product.id, location.id, 20);

    const saleRes = await request(app)
      .post("/api/sales")
      .set("Authorization", `Bearer ${cashierToken}`)
      .send({
        id: randomUUID(),
        saleNumber: `SL-${randomUUID().slice(0, 12).toUpperCase()}`,
        shiftId,
        soldAt: new Date().toISOString(),
        paymentMethod: "CASH",
        amountTendered: "1000.00",
        items: [
          {
            productId: product.id,
            quantity: 3,
            unitPrice: "4.00",
            discountAmount: "2.00",
          },
        ],
      });

    const sale = await prisma.sale.findUnique({
      where: { id: saleRes.body.data.id },
      include: { items: true },
    });
    if (!sale) {
      throw new Error("Expected sale to exist after creation");
    }
    const saleItem = sale.items[0];
    if (!saleItem) {
      throw new Error("Expected sale to have at least one item");
    }
    expect(saleItem.lineTotal.toString()).toBe("10");

    let refundCents = 0;
    for (let i = 0; i < 3; i++) {
      const res = await request(app)
        .post(`/api/sales/${sale.id}/returns`)
        .set("Authorization", `Bearer ${cashierToken}`)
        .send({
          shiftId,
          refundMethod: "CASH",
          items: [{ saleItemId: saleItem.id, quantity: 1, disposition: "RESTOCK" }],
        });
      expect(res.status).toBe(201);
      refundCents += Math.round(Number(res.body.data.refundAmount) * 100);
    }

    expect(refundCents).toBe(1000);
  });

  it("keeps the return header exactly equal to the sum of its lines across two uneven items", async () => {
    await enablePos(tenant.tenant.id, 50);

    const productOne = await createProduct(tenant.tenant.id);
    const productTwo = await createProduct(tenant.tenant.id);
    await seedStock(tenant.tenant.id, productOne.id, location.id, 20);
    await seedStock(tenant.tenant.id, productTwo.id, location.id, 20);

    const saleRes = await request(app)
      .post("/api/sales")
      .set("Authorization", `Bearer ${cashierToken}`)
      .send({
        id: randomUUID(),
        saleNumber: `SL-${randomUUID().slice(0, 12).toUpperCase()}`,
        shiftId,
        soldAt: new Date().toISOString(),
        paymentMethod: "CASH",
        amountTendered: "1000.00",
        items: [
          { productId: productOne.id, quantity: 3, unitPrice: "4.00", discountAmount: "2.00" },
          { productId: productTwo.id, quantity: 3, unitPrice: "4.00", discountAmount: "2.00" },
        ],
      });
    expect(saleRes.status).toBe(201);

    const sale = await prisma.sale.findUnique({
      where: { id: saleRes.body.data.id },
      include: { items: true },
    });
    if (!sale) {
      throw new Error("Expected sale to exist after creation");
    }
    const saleItemOne = sale.items.find((item) => item.productId === productOne.id);
    const saleItemTwo = sale.items.find((item) => item.productId === productTwo.id);
    if (!saleItemOne || !saleItemTwo) {
      throw new Error("Expected sale to have both items");
    }
    expect(saleItemOne.lineTotal.toString()).toBe("10");
    expect(saleItemTwo.lineTotal.toString()).toBe("10");

    const returnRes = await request(app)
      .post(`/api/sales/${sale.id}/returns`)
      .set("Authorization", `Bearer ${cashierToken}`)
      .send({
        shiftId,
        refundMethod: "CASH",
        items: [
          { saleItemId: saleItemOne.id, quantity: 1, disposition: "RESTOCK" },
          { saleItemId: saleItemTwo.id, quantity: 1, disposition: "RESTOCK" },
        ],
      });
    expect(returnRes.status).toBe(201);

    const saleReturn = await prisma.saleReturn.findUnique({
      where: { id: returnRes.body.data.id },
      include: { items: true },
    });
    if (!saleReturn) {
      throw new Error("Expected return to exist after creation");
    }
    expect(saleReturn.items).toHaveLength(2);

    const linesTotalCents = saleReturn.items.reduce(
      (sum, item) => sum + Math.round(Number(item.refundAmount) * 100),
      0,
    );
    const headerCents = Math.round(Number(saleReturn.refundAmount) * 100);

    expect(headerCents).toBe(linesTotalCents);
    expect(headerCents).toBe(666);
  });

  it("rounds a partial return up at an exact half-pesewa boundary instead of truncating the per-unit rate", async () => {
    await enablePos(tenant.tenant.id, 50);

    const product = await createProduct(tenant.tenant.id);
    await seedStock(tenant.tenant.id, product.id, location.id, 20);

    const saleRes = await request(app)
      .post("/api/sales")
      .set("Authorization", `Bearer ${cashierToken}`)
      .send({
        id: randomUUID(),
        saleNumber: `SL-${randomUUID().slice(0, 12).toUpperCase()}`,
        shiftId,
        soldAt: new Date().toISOString(),
        paymentMethod: "CASH",
        amountTendered: "1000.00",
        items: [
          {
            productId: product.id,
            quantity: 6,
            unitPrice: "1.10",
            discountAmount: "0.55",
          },
        ],
      });

    const sale = await prisma.sale.findUnique({
      where: { id: saleRes.body.data.id },
      include: { items: true },
    });
    if (!sale) {
      throw new Error("Expected sale to exist after creation");
    }
    const saleItem = sale.items[0];
    if (!saleItem) {
      throw new Error("Expected sale to have at least one item");
    }
    expect(saleItem.lineTotal.toString()).toBe("6.05");

    const res = await request(app)
      .post(`/api/sales/${sale.id}/returns`)
      .set("Authorization", `Bearer ${cashierToken}`)
      .send({
        shiftId,
        refundMethod: "CASH",
        items: [{ saleItemId: saleItem.id, quantity: 3, disposition: "RESTOCK" }],
      });

    expect(res.status).toBe(201);
    expect(res.body.data.refundAmount).toBe("3.03");
  });
});
