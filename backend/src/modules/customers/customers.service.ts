import { logActivity } from "../../lib/activity-logger.ts";
import { NotFoundError } from "../../shared/errors.ts";
import { paginate } from "../../shared/pagination.ts";
import { withUniqueConstraint } from "../../shared/prisma-errors.ts";
import * as customersRepository from "./customers.repository.ts";
import type { CreateCustomerInput, UpdateCustomerInput } from "./customers.validators.ts";

const PHONE_TAKEN = {
  field: "phone",
  message: "A customer with that phone number already exists",
};

export async function create(tenantId: string, userId: string, input: CreateCustomerInput) {
  const customer = await withUniqueConstraint(
    () => customersRepository.create(tenantId, input),
    PHONE_TAKEN,
  );
  await logActivity({
    tenantId,
    userId,
    action: "CUSTOMER_CREATED",
    description: `Customer ${customer.name} created`,
  });
  return customer;
}

export async function get(tenantId: string, id: string) {
  const customer = await customersRepository.findById(tenantId, id);
  if (!customer) {
    throw new NotFoundError("Customer not found");
  }
  return customer;
}

export async function update(
  tenantId: string,
  userId: string,
  id: string,
  input: UpdateCustomerInput,
) {
  await get(tenantId, id);
  await withUniqueConstraint(
    () => customersRepository.update(tenantId, id, input),
    PHONE_TAKEN,
  );
  await logActivity({
    tenantId,
    userId,
    action: "CUSTOMER_UPDATED",
    description: `Customer ${id} updated`,
  });
  return customersRepository.findById(tenantId, id);
}

export function list(tenantId: string, rawQuery: unknown) {
  return paginate(rawQuery, (skip, take, search) =>
    customersRepository.list(tenantId, skip, take, search),
  );
}

export async function listSales(tenantId: string, customerId: string, rawQuery: unknown) {
  await get(tenantId, customerId);
  return paginate(rawQuery, (skip, take) =>
    customersRepository.listSales(tenantId, customerId, skip, take),
  );
}
