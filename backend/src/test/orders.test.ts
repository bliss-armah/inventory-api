import { afterAll, beforeAll, describe, expect, it } from "vitest";
import request from "supertest";
import { randomUUID } from "node:crypto";
import { app } from "../app";
import { prisma } from "../lib/prisma";
import { expireStaleOrders } from "../modules/orders/orders.service";
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

describe("orders", { retry: 0 }, () => {
  let tenant: Awaited<ReturnType<typeof createTenantWithOwner>>;
  let other: Awaited<ReturnType<typeof createTenantWithOwner>>;
  let location: Awaited<ReturnType<typeof createLocation>>;
  let cashierToken: string;
  let shiftId: string;

  beforeAll(async () => {
    tenant = await createTenantWithOwner("Orders Co");
    other = await createTenantWithOwner("Other Orders Co");
    location = await createLocation(tenant.tenant.id);
    await enablePos(tenant.tenant.id, 10);
    await enablePos(other.tenant.id);

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
    await deleteTenant(other.tenant.id);
  });

  async function stockedProduct(quantity: number) {
    const product = await createProduct(tenant.tenant.id);
    await seedStock(tenant.tenant.id, product.id, location.id, quantity);
    return product;
  }

  async function inventoryOf(productId: string) {
    return prisma.inventory.findUniqueOrThrow({
      where: { productId_locationId: { productId, locationId: location.id } },
    });
  }

  function createOrder(token: string, items: Array<{ productId: string; quantity: number }>, id = randomUUID()) {
    return request(app)
      .post("/api/orders")
      .set("Authorization", `Bearer ${token}`)
      .send({ id, locationId: location.id, customerName: "Kofi", items });
  }

  function payOrder(
    token: string,
    orderId: string,
    items: Array<{ productId: string; quantity: number; unitPrice: string }>,
    amountTendered = "1000.00",
  ) {
    return request(app)
      .post("/api/sales")
      .set("Authorization", `Bearer ${token}`)
      .send({
        id: randomUUID(),
        saleNumber: `SL-${randomUUID().slice(0, 12).toUpperCase()}`,
        shiftId,
        orderId,
        soldAt: new Date().toISOString(),
        paymentMethod: "CASH",
        amountTendered,
        items,
      });
  }

  it("prices the slip from the catalogue and reserves the stock", async () => {
    const product = await stockedProduct(10);

    const res = await createOrder(cashierToken, [{ productId: product.id, quantity: 4 }]);

    expect(res.status).toBe(201);
    expect(res.body.data.orderNumber).toMatch(/^ORD-\d{6}$/);
    expect(res.body.data.status).toBe("OPEN");
    expect(Number(res.body.data.total)).toBe(80);
    expect(Number(res.body.data.items[0].unitPrice)).toBe(20);

    const inventory = await inventoryOf(product.id);
    expect(inventory.quantity).toBe(10);
    expect(inventory.reservedQuantity).toBe(4);
  });

  it("resolves the only location when none is named, for both catalogue and slip", async () => {
    const product = await stockedProduct(5);

    const catalog = await request(app)
      .get("/api/sales/catalog")
      .set("Authorization", `Bearer ${tenant.token}`);
    expect(catalog.status).toBe(200);
    expect(
      catalog.body.data.find((entry: { id: string }) => entry.id === product.id).availableQuantity,
    ).toBe(5);

    const res = await request(app)
      .post("/api/orders")
      .set("Authorization", `Bearer ${tenant.token}`)
      .send({ id: randomUUID(), items: [{ productId: product.id, quantity: 2 }] });
    expect(res.status).toBe(201);
    expect(res.body.data.locationId).toBe(location.id);
    expect((await inventoryOf(product.id)).reservedQuantity).toBe(2);
  });

  it("lets the owner write up a slip too", async () => {
    const product = await stockedProduct(5);
    const res = await createOrder(tenant.token, [{ productId: product.id, quantity: 1 }]);
    expect(res.status).toBe(201);
  });

  it("merges repeated products into one line", async () => {
    const product = await stockedProduct(10);
    const res = await createOrder(cashierToken, [
      { productId: product.id, quantity: 2 },
      { productId: product.id, quantity: 3 },
    ]);
    expect(res.status).toBe(201);
    expect(res.body.data.items).toHaveLength(1);
    expect(res.body.data.items[0].quantity).toBe(5);
    expect((await inventoryOf(product.id)).reservedQuantity).toBe(5);
  });

  it("is idempotent on the client-generated id", async () => {
    const product = await stockedProduct(10);
    const id = randomUUID();

    const first = await createOrder(cashierToken, [{ productId: product.id, quantity: 2 }], id);
    const second = await createOrder(cashierToken, [{ productId: product.id, quantity: 2 }], id);

    expect(first.status).toBe(201);
    expect(second.status).toBe(200);
    expect(second.body.data.orderNumber).toBe(first.body.data.orderNumber);
    expect((await inventoryOf(product.id)).reservedQuantity).toBe(2);
  });

  it("refuses to promise stock that is already reserved and leaves nothing behind", async () => {
    const plenty = await stockedProduct(100);
    const scarce = await stockedProduct(3);

    await createOrder(cashierToken, [{ productId: scarce.id, quantity: 2 }]).expect(201);

    const id = randomUUID();
    const res = await createOrder(
      cashierToken,
      [
        { productId: plenty.id, quantity: 5 },
        { productId: scarce.id, quantity: 2 },
      ],
      id,
    );

    expect(res.status).toBe(400);
    expect(res.body.message).toMatch(/Insufficient available stock/);
    expect(await prisma.order.findUnique({ where: { id } })).toBeNull();
    expect((await inventoryOf(plenty.id)).reservedQuantity).toBe(0);
    expect((await inventoryOf(scarce.id)).reservedQuantity).toBe(2);
  });

  it("finds a slip by the number printed on it", async () => {
    const product = await stockedProduct(5);
    const created = await createOrder(cashierToken, [{ productId: product.id, quantity: 1 }]);
    const number: string = created.body.data.orderNumber;

    const res = await request(app)
      .get(`/api/orders/by-number/${number.toLowerCase()}`)
      .set("Authorization", `Bearer ${cashierToken}`);

    expect(res.status).toBe(200);
    expect(res.body.data.id).toBe(created.body.data.id);
  });

  it("settles as a sale: stock leaves, reservation clears, order is paid", async () => {
    const product = await stockedProduct(10);
    const created = await createOrder(cashierToken, [{ productId: product.id, quantity: 3 }]);
    const orderId: string = created.body.data.id;

    const res = await payOrder(cashierToken, orderId, [
      { productId: product.id, quantity: 3, unitPrice: "20.00" },
    ]);

    expect(res.status).toBe(201);
    expect(Number(res.body.data.total)).toBe(60);

    const inventory = await inventoryOf(product.id);
    expect(inventory.quantity).toBe(7);
    expect(inventory.reservedQuantity).toBe(0);

    const order = await prisma.order.findUniqueOrThrow({ where: { id: orderId } });
    expect(order.status).toBe("PAID");
    expect(order.saleId).toBe(res.body.data.id);
    expect(order.paidAt).not.toBeNull();
  });

  it("lets a different cashier than the writer take the payment", async () => {
    const product = await stockedProduct(10);
    const created = await createOrder(tenant.token, [{ productId: product.id, quantity: 1 }]);

    const res = await payOrder(cashierToken, created.body.data.id, [
      { productId: product.id, quantity: 1, unitPrice: "20.00" },
    ]);

    expect(res.status).toBe(201);
  });

  it("rejects a sale whose items drifted from the slip and keeps the slip open", async () => {
    const product = await stockedProduct(10);
    const created = await createOrder(cashierToken, [{ productId: product.id, quantity: 3 }]);
    const orderId: string = created.body.data.id;

    const res = await payOrder(cashierToken, orderId, [
      { productId: product.id, quantity: 2, unitPrice: "20.00" },
    ]);

    expect(res.status).toBe(400);
    expect((await prisma.order.findUniqueOrThrow({ where: { id: orderId } })).status).toBe("OPEN");
    const inventory = await inventoryOf(product.id);
    expect(inventory.quantity).toBe(10);
    expect(inventory.reservedQuantity).toBe(3);
  });

  it("rejects a sale at a different price than the slip locked", async () => {
    const product = await stockedProduct(10);
    const created = await createOrder(cashierToken, [{ productId: product.id, quantity: 1 }]);

    const res = await payOrder(cashierToken, created.body.data.id, [
      { productId: product.id, quantity: 1, unitPrice: "5.00" },
    ]);

    expect(res.status).toBe(400);
  });

  it("keeps the locked price when the catalogue price changes afterwards", async () => {
    const product = await stockedProduct(10);
    const created = await createOrder(cashierToken, [{ productId: product.id, quantity: 1 }]);
    await prisma.product.update({ where: { id: product.id }, data: { sellingPrice: 25 } });

    const res = await payOrder(cashierToken, created.body.data.id, [
      { productId: product.id, quantity: 1, unitPrice: "20.00" },
    ]);

    expect(res.status).toBe(201);
    expect(res.body.data.priceDiscrepancy).toBe(true);
  });

  it("refuses to pay the same slip twice", async () => {
    const product = await stockedProduct(10);
    const created = await createOrder(cashierToken, [{ productId: product.id, quantity: 2 }]);
    const lines = [{ productId: product.id, quantity: 2, unitPrice: "20.00" }];

    await payOrder(cashierToken, created.body.data.id, lines).expect(201);
    const second = await payOrder(cashierToken, created.body.data.id, lines);

    expect(second.status).toBe(409);
    expect((await inventoryOf(product.id)).quantity).toBe(8);
  });

  it("cancelling releases the reservation and blocks later payment", async () => {
    const product = await stockedProduct(10);
    const created = await createOrder(cashierToken, [{ productId: product.id, quantity: 6 }]);
    const orderId: string = created.body.data.id;

    const cancelled = await request(app)
      .post(`/api/orders/${orderId}/cancel`)
      .set("Authorization", `Bearer ${cashierToken}`);

    expect(cancelled.status).toBe(200);
    expect(cancelled.body.data.status).toBe("CANCELLED");
    expect((await inventoryOf(product.id)).reservedQuantity).toBe(0);

    const pay = await payOrder(cashierToken, orderId, [
      { productId: product.id, quantity: 6, unitPrice: "20.00" },
    ]);
    expect(pay.status).toBe(409);
  });

  it("cannot cancel a slip that was already paid", async () => {
    const product = await stockedProduct(10);
    const created = await createOrder(cashierToken, [{ productId: product.id, quantity: 1 }]);
    await payOrder(cashierToken, created.body.data.id, [
      { productId: product.id, quantity: 1, unitPrice: "20.00" },
    ]).expect(201);

    const res = await request(app)
      .post(`/api/orders/${created.body.data.id}/cancel`)
      .set("Authorization", `Bearer ${cashierToken}`);

    expect(res.status).toBe(409);
    expect((await inventoryOf(product.id)).quantity).toBe(9);
  });

  it("expires stale open slips and releases their stock", async () => {
    const product = await stockedProduct(10);
    const created = await createOrder(cashierToken, [{ productId: product.id, quantity: 4 }]);
    const orderId: string = created.body.data.id;
    await prisma.order.update({
      where: { id: orderId },
      data: { createdAt: new Date(Date.now() - 48 * 60 * 60 * 1000) },
    });

    const expired = await expireStaleOrders(24);

    expect(expired).toBeGreaterThanOrEqual(1);
    expect((await prisma.order.findUniqueOrThrow({ where: { id: orderId } })).status).toBe("EXPIRED");
    expect((await inventoryOf(product.id)).reservedQuantity).toBe(0);
  });

  it("does not expire a fresh slip", async () => {
    const product = await stockedProduct(10);
    const created = await createOrder(cashierToken, [{ productId: product.id, quantity: 1 }]);

    await expireStaleOrders(24);

    expect((await prisma.order.findUniqueOrThrow({ where: { id: created.body.data.id } })).status).toBe("OPEN");
  });

  it("hides one business's slips from another", async () => {
    const product = await stockedProduct(10);
    const created = await createOrder(cashierToken, [{ productId: product.id, quantity: 1 }]);

    const byId = await request(app)
      .get(`/api/orders/${created.body.data.id}`)
      .set("Authorization", `Bearer ${other.token}`);
    const byNumber = await request(app)
      .get(`/api/orders/by-number/${created.body.data.orderNumber}`)
      .set("Authorization", `Bearer ${other.token}`);

    expect(byId.status).toBe(404);
    expect(byNumber.status).toBe(404);
  });

  it("records picking progress per line and reports it on the order", async () => {
    const a = await stockedProduct(10);
    const b = await stockedProduct(10);
    const created = await createOrder(cashierToken, [
      { productId: a.id, quantity: 4 },
      { productId: b.id, quantity: 2 },
    ]);
    const items: Array<{ id: string; productId: string; pickedQuantity: number }> = created.body.data.items;
    expect(items.every((item) => item.pickedQuantity === 0)).toBe(true);
    const lineA = items.find((item) => item.productId === a.id)!;

    const res = await request(app)
      .put(`/api/orders/${created.body.data.id}/picking`)
      .set("Authorization", `Bearer ${tenant.token}`)
      .send({ items: [{ itemId: lineA.id, pickedQuantity: 3 }] });

    expect(res.status).toBe(200);
    const after: Array<{ productId: string; pickedQuantity: number }> = res.body.data.items;
    expect(after.find((item) => item.productId === a.id)?.pickedQuantity).toBe(3);
    expect(after.find((item) => item.productId === b.id)?.pickedQuantity).toBe(0);
  });

  it("refuses to pick more than was ordered or an item from another order", async () => {
    const product = await stockedProduct(10);
    const created = await createOrder(cashierToken, [{ productId: product.id, quantity: 2 }]);
    const other = await createOrder(cashierToken, [{ productId: product.id, quantity: 1 }]);
    const line = created.body.data.items[0];
    const foreignLine = other.body.data.items[0];

    const tooMany = await request(app)
      .put(`/api/orders/${created.body.data.id}/picking`)
      .set("Authorization", `Bearer ${cashierToken}`)
      .send({ items: [{ itemId: line.id, pickedQuantity: 3 }] });
    const foreign = await request(app)
      .put(`/api/orders/${created.body.data.id}/picking`)
      .set("Authorization", `Bearer ${cashierToken}`)
      .send({ items: [{ itemId: foreignLine.id, pickedQuantity: 1 }] });

    expect(tooMany.status).toBe(400);
    expect(foreign.status).toBe(400);
  });

  it("allows picking to be undone", async () => {
    const product = await stockedProduct(10);
    const created = await createOrder(cashierToken, [{ productId: product.id, quantity: 2 }]);
    const line = created.body.data.items[0];
    const url = `/api/orders/${created.body.data.id}/picking`;

    await request(app).put(url).set("Authorization", `Bearer ${cashierToken}`)
      .send({ items: [{ itemId: line.id, pickedQuantity: 2 }] }).expect(200);
    const undone = await request(app).put(url).set("Authorization", `Bearer ${cashierToken}`)
      .send({ items: [{ itemId: line.id, pickedQuantity: 0 }] });

    expect(undone.body.data.items[0].pickedQuantity).toBe(0);
  });

  it("stops picking once the order is paid or cancelled", async () => {
    const product = await stockedProduct(10);
    const paid = await createOrder(cashierToken, [{ productId: product.id, quantity: 1 }]);
    await payOrder(cashierToken, paid.body.data.id, [
      { productId: product.id, quantity: 1, unitPrice: "20.00" },
    ]).expect(201);
    const cancelled = await createOrder(cashierToken, [{ productId: product.id, quantity: 1 }]);
    await request(app).post(`/api/orders/${cancelled.body.data.id}/cancel`)
      .set("Authorization", `Bearer ${cashierToken}`).expect(200);

    const onPaid = await request(app)
      .put(`/api/orders/${paid.body.data.id}/picking`)
      .set("Authorization", `Bearer ${cashierToken}`)
      .send({ items: [{ itemId: paid.body.data.items[0].id, pickedQuantity: 1 }] });
    const onCancelled = await request(app)
      .put(`/api/orders/${cancelled.body.data.id}/picking`)
      .set("Authorization", `Bearer ${cashierToken}`)
      .send({ items: [{ itemId: cancelled.body.data.items[0].id, pickedQuantity: 1 }] });

    expect(onPaid.status).toBe(409);
    expect(onCancelled.status).toBe(409);
  });

  it("does not let another business touch an order's picking", async () => {
    const product = await stockedProduct(10);
    const created = await createOrder(cashierToken, [{ productId: product.id, quantity: 1 }]);

    const res = await request(app)
      .put(`/api/orders/${created.body.data.id}/picking`)
      .set("Authorization", `Bearer ${other.token}`)
      .send({ items: [{ itemId: created.body.data.items[0].id, pickedQuantity: 1 }] });

    expect(res.status).toBe(404);
  });

  it("honours an order number and prices chosen offline, so a printed slip stays valid", async () => {
    const product = await stockedProduct(10);
    const orderNumber = `ORD-${String(Math.floor(Math.random() * 900000) + 100000)}`;

    const res = await request(app)
      .post("/api/orders")
      .set("Authorization", `Bearer ${cashierToken}`)
      .send({
        id: randomUUID(),
        orderNumber,
        locationId: location.id,
        items: [{ productId: product.id, quantity: 3, unitPrice: "17.50" }],
      });

    expect(res.status).toBe(201);
    expect(res.body.data.orderNumber).toBe(orderNumber);
    expect(Number(res.body.data.items[0].unitPrice)).toBe(17.5);
    expect(Number(res.body.data.total)).toBe(52.5);
    expect((await inventoryOf(product.id)).reservedQuantity).toBe(3);
  });

  it("returns 409 when a chosen order number is already taken and reserves nothing", async () => {
    const product = await stockedProduct(10);
    const first = await createOrder(cashierToken, [{ productId: product.id, quantity: 1 }]);

    const clash = await request(app)
      .post("/api/orders")
      .set("Authorization", `Bearer ${cashierToken}`)
      .send({
        id: randomUUID(),
        orderNumber: first.body.data.orderNumber,
        locationId: location.id,
        items: [{ productId: product.id, quantity: 2 }],
      });

    expect(clash.status).toBe(409);
    expect((await inventoryOf(product.id)).reservedQuantity).toBe(1);
  });

  it("rejects a malformed order number or price", async () => {
    const product = await stockedProduct(10);
    const base = { id: randomUUID(), locationId: location.id };

    const badNumber = await request(app)
      .post("/api/orders")
      .set("Authorization", `Bearer ${cashierToken}`)
      .send({ ...base, orderNumber: "ORD-ABC", items: [{ productId: product.id, quantity: 1 }] });
    const badPrice = await request(app)
      .post("/api/orders")
      .set("Authorization", `Bearer ${cashierToken}`)
      .send({ ...base, id: randomUUID(), items: [{ productId: product.id, quantity: 1, unitPrice: "-3" }] });

    expect(badNumber.status).toBe(400);
    expect(badPrice.status).toBe(400);
  });

  it("replays an offline order idempotently on its id", async () => {
    const product = await stockedProduct(10);
    const body = {
      id: randomUUID(),
      orderNumber: "ORD-424242",
      locationId: location.id,
      items: [{ productId: product.id, quantity: 2, unitPrice: "20.00" }],
    };

    const first = await request(app).post("/api/orders").set("Authorization", `Bearer ${cashierToken}`).send(body);
    const replay = await request(app).post("/api/orders").set("Authorization", `Bearer ${cashierToken}`).send(body);

    expect(first.status).toBe(201);
    expect(replay.status).toBe(200);
    expect((await inventoryOf(product.id)).reservedQuantity).toBe(2);
  });

  it("lists open slips filtered by status", async () => {
    const product = await stockedProduct(10);
    const created = await createOrder(cashierToken, [{ productId: product.id, quantity: 1 }]);

    const res = await request(app)
      .get("/api/orders?status=OPEN")
      .set("Authorization", `Bearer ${cashierToken}`);

    expect(res.status).toBe(200);
    expect(res.body.data.items.some((order: { id: string }) => order.id === created.body.data.id)).toBe(true);
    expect(res.body.data.items.every((order: { status: string }) => order.status === "OPEN")).toBe(true);
  });
});
