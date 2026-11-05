import { randomBytes } from "node:crypto";
import { OrderStatus, Prisma } from "../../generated/prisma";
import { logActivity } from "../../lib/activity-logger.ts";
import { prisma } from "../../lib/prisma.ts";
import type { PrismaTransactionClient } from "../../lib/transaction.ts";
import { BadRequestError, ConflictError, NotFoundError } from "../../shared/errors.ts";
import { assertOwned } from "../../shared/ownership.ts";
import { paginate } from "../../shared/pagination.ts";
import { releaseStock, reserveStock } from "../inventory/inventory.service.ts";
import { resolveLocationId } from "../shifts/shifts.service.ts";
import * as ordersRepository from "./orders.repository.ts";
import { ordersListQuerySchema } from "./orders.validators.ts";
import type { CreateOrderInput } from "./orders.validators.ts";

const ORDER_NUMBER_ALPHABET = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
const ORDER_NUMBER_LENGTH = 6;
const ORDER_NUMBER_ATTEMPTS = 5;

function generateOrderNumber() {
  const bytes = randomBytes(ORDER_NUMBER_LENGTH);
  const code = Array.from(bytes, (byte) => ORDER_NUMBER_ALPHABET[byte % ORDER_NUMBER_ALPHABET.length]).join("");
  return `ORD-${code}`;
}

function mergeLines(items: CreateOrderInput["items"]) {
  const quantities = new Map<string, number>();
  for (const item of items) {
    quantities.set(item.productId, (quantities.get(item.productId) ?? 0) + item.quantity);
  }
  return [...quantities.entries()]
    .map(([productId, quantity]) => ({ productId, quantity }))
    .sort((a, b) => a.productId.localeCompare(b.productId));
}

function isUniqueViolation(error: unknown) {
  return error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002";
}

export async function create(tenantId: string, userId: string, input: CreateOrderInput) {
  const existing = await ordersRepository.findById(tenantId, input.id);
  if (existing) {
    return { order: existing, alreadyExisted: true };
  }

  const locationId = await resolveLocationId(tenantId, input.locationId);
  const lines = mergeLines(input.items);

  await assertOwned(tenantId, { productIds: lines.map((line) => line.productId) });

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
    where: {
      tenantId,
      status: "ACTIVE",
      id: { in: lines.map((line) => line.productId) },
    },
    select: { id: true, name: true, sellingPrice: true },
  });
  const productById = new Map(products.map((product) => [product.id, product]));

  const priced = lines.map((line) => {
    const product = productById.get(line.productId);
    if (!product) {
      throw new BadRequestError("One of the products on this order is no longer available");
    }
    return {
      ...line,
      name: product.name,
      unitPrice: product.sellingPrice,
      lineTotal: product.sellingPrice.times(line.quantity),
    };
  });
  const total = priced.reduce((sum, line) => sum.plus(line.lineTotal), new Prisma.Decimal(0));

  for (let attempt = 0; attempt < ORDER_NUMBER_ATTEMPTS; attempt += 1) {
    try {
      const orderId = await prisma.$transaction(async (tx) => {
        const order = await ordersRepository.createOrder(tx, {
          id: input.id,
          tenantId,
          orderNumber: generateOrderNumber(),
          locationId,
          createdById: userId,
          customerId: input.customerId ?? null,
          customerName: input.customerName ?? null,
          note: input.note ?? null,
          total,
        });

        await ordersRepository.createItems(
          tx,
          priced.map((line) => ({
            tenantId,
            orderId: order.id,
            productId: line.productId,
            quantity: line.quantity,
            unitPrice: line.unitPrice,
            lineTotal: line.lineTotal,
          })),
        );

        for (const line of priced) {
          try {
            await reserveStock(tx, {
              tenantId,
              productId: line.productId,
              locationId,
              quantity: line.quantity,
            });
          } catch (error) {
            if (error instanceof BadRequestError) {
              throw new BadRequestError(`${line.name}: ${error.message}`);
            }
            throw error;
          }
        }

        await logActivity(
          {
            tenantId,
            userId,
            action: "ORDER_CREATED",
            description: `Order ${order.orderNumber} for ${total}`,
          },
          tx,
        );

        return order.id;
      });

      const order = await ordersRepository.findById(tenantId, orderId);
      if (!order) {
        throw new NotFoundError("Order was created but could not be found");
      }
      return { order, alreadyExisted: false };
    } catch (error) {
      if (!isUniqueViolation(error)) {
        throw error;
      }
      const committed = await ordersRepository.findById(tenantId, input.id);
      if (committed) {
        return { order: committed, alreadyExisted: true };
      }
    }
  }

  throw new ConflictError("Could not allocate an order number, please try again");
}

export async function get(tenantId: string, id: string) {
  const order = await ordersRepository.findById(tenantId, id);
  if (!order) {
    throw new NotFoundError("Order not found");
  }
  return order;
}

export async function getByNumber(tenantId: string, orderNumber: string) {
  const order = await ordersRepository.findByNumber(tenantId, orderNumber.trim().toUpperCase());
  if (!order) {
    throw new NotFoundError("Order not found");
  }
  return order;
}

export function list(tenantId: string, rawQuery: unknown) {
  const { status } = ordersListQuerySchema.parse(rawQuery);
  return paginate(rawQuery, (skip, take, search) =>
    ordersRepository.list(tenantId, skip, take, { status, search }),
  );
}

type ClosingStatus = typeof OrderStatus.CANCELLED | typeof OrderStatus.EXPIRED;

async function closeOpenOrder(
  tx: PrismaTransactionClient,
  tenantId: string,
  id: string,
  status: ClosingStatus,
) {
  const claimed = await ordersRepository.claimOpen(tx, tenantId, id, {
    status,
    cancelledAt: new Date(),
  });
  if (claimed.count === 0) {
    const current = await tx.order.findFirst({ where: { tenantId, id }, select: { status: true } });
    if (!current) {
      throw new NotFoundError("Order not found");
    }
    throw new ConflictError(`This order is already ${current.status.toLowerCase()}`);
  }

  const order = await tx.order.findFirstOrThrow({
    where: { tenantId, id },
    select: { orderNumber: true, locationId: true },
  });
  const items = await ordersRepository.findItems(tx, tenantId, id);
  for (const item of items) {
    await releaseStock(tx, {
      tenantId,
      productId: item.productId,
      locationId: order.locationId,
      quantity: item.quantity,
    });
  }
  return order;
}

export async function cancel(tenantId: string, userId: string, id: string) {
  await prisma.$transaction(async (tx) => {
    const order = await closeOpenOrder(tx, tenantId, id, OrderStatus.CANCELLED);
    await logActivity(
      {
        tenantId,
        userId,
        action: "ORDER_CANCELLED",
        description: `Order ${order.orderNumber} cancelled and stock released`,
      },
      tx,
    );
  });
  return get(tenantId, id);
}

export async function expireStaleOrders(holdHours: number, now = new Date()) {
  const cutoff = new Date(now.getTime() - holdHours * 60 * 60 * 1000);
  const stale = await ordersRepository.findStaleOpenIds(cutoff);
  let expired = 0;

  for (const { id, tenantId } of stale) {
    try {
      await prisma.$transaction(async (tx) => {
        const order = await closeOpenOrder(tx, tenantId, id, OrderStatus.EXPIRED);
        await logActivity(
          {
            tenantId,
            action: "ORDER_EXPIRED",
            description: `Order ${order.orderNumber} expired and stock released`,
          },
          tx,
        );
      });
      expired += 1;
    } catch (error) {
      if (!(error instanceof ConflictError) && !(error instanceof NotFoundError)) {
        throw error;
      }
    }
  }
  return expired;
}

type SaleLine = { productId: string; quantity: number; unitPrice: Prisma.Decimal };

export async function loadPayableOrder(tenantId: string, orderId: string, shiftLocationId: string) {
  const order = await prisma.order.findFirst({
    where: { tenantId, id: orderId },
    include: { items: true },
  });
  if (!order) {
    throw new NotFoundError("Order not found");
  }
  if (order.status !== OrderStatus.OPEN) {
    throw new ConflictError(`This order is already ${order.status.toLowerCase()}`);
  }
  if (order.locationId !== shiftLocationId) {
    throw new BadRequestError("This order was written for a different location");
  }
  return order;
}

export function assertSaleMatchesOrder(
  order: { orderNumber: string; items: Array<{ productId: string; quantity: number; unitPrice: Prisma.Decimal }> },
  saleLines: SaleLine[],
) {
  const expected = new Map(order.items.map((item) => [item.productId, item]));
  const matches =
    saleLines.length === expected.size &&
    saleLines.every((line) => {
      const item = expected.get(line.productId);
      return item && item.quantity === line.quantity && item.unitPrice.equals(line.unitPrice);
    });
  if (!matches) {
    throw new BadRequestError(`The items no longer match order ${order.orderNumber}`);
  }
}

export async function settleOrder(
  tx: PrismaTransactionClient,
  input: {
    tenantId: string;
    userId: string;
    saleId: string;
    saleNumber: string;
    order: {
      id: string;
      orderNumber: string;
      locationId: string;
      items: Array<{ productId: string; quantity: number }>;
    };
  },
) {
  const claimed = await ordersRepository.claimOpen(tx, input.tenantId, input.order.id, {
    status: OrderStatus.PAID,
    saleId: input.saleId,
    paidAt: new Date(),
  });
  if (claimed.count === 0) {
    throw new ConflictError(`Order ${input.order.orderNumber} was already settled or cancelled`);
  }

  const items = [...input.order.items].sort((a, b) => a.productId.localeCompare(b.productId));
  for (const item of items) {
    await releaseStock(tx, {
      tenantId: input.tenantId,
      productId: item.productId,
      locationId: input.order.locationId,
      quantity: item.quantity,
    });
  }

  await logActivity(
    {
      tenantId: input.tenantId,
      userId: input.userId,
      action: "ORDER_PAID",
      description: `Order ${input.order.orderNumber} paid as sale ${input.saleNumber}`,
    },
    tx,
  );
}
