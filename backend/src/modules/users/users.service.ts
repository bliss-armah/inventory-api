import { hashPassword } from "../../lib/password.ts";
import {
  BadRequestError,
  ConflictError,
  NotFoundError,
} from "../../shared/errors.ts";
import { paginate } from "../../shared/pagination.ts";
import { withUniqueConstraints } from "../../shared/prisma-errors.ts";
import { Role } from "../../generated/prisma";
import * as usersRepository from "./users.repository.ts";
import * as authRepository from "../auth/auth.repository.ts";
import type { CreateUserInput, UpdateUserInput } from "./users.validators.ts";

export function list(tenantId: string, rawQuery: unknown) {
  return paginate(rawQuery, (skip, take, search) =>
    usersRepository.list(tenantId, skip, take, search),
  );
}

export async function create(tenantId: string, input: CreateUserInput) {
  const existing = await usersRepository.findByEmail(input.email);
  if (existing) {
    throw new ConflictError("An account with this email already exists", {
      email: ["An account with this email already exists"],
    });
  }
  const passwordHash = await hashPassword(input.password);
  return withUniqueConstraints(
    () => usersRepository.create(tenantId, input, passwordHash),
    [
      {
        field: "email",
        message: "An account with this email already exists",
        match: "email",
      },
      {
        field: "phone",
        message: "That phone number is already in use",
        match: "phone",
      },
    ],
  );
}

export async function update(
  tenantId: string,
  id: string,
  input: UpdateUserInput,
) {
  const existing = await usersRepository.findByIdInTenant(tenantId, id);
  if (!existing) {
    throw new NotFoundError("Staff member not found");
  }

  const losingOwnerStatus =
    existing.role === Role.OWNER &&
    existing.isActive &&
    ((input.role !== undefined && input.role !== Role.OWNER) ||
      (input.isActive !== undefined && !input.isActive));

  if (losingOwnerStatus) {
    const remainingOwners = await usersRepository.countActiveOwners(
      tenantId,
      id,
    );
    if (remainingOwners === 0) {
      throw new BadRequestError(
        "Cannot remove the last active owner of this business",
      );
    }
  }

  const updated = await withUniqueConstraints(
    () => usersRepository.update(tenantId, id, input),
    [{ field: "phone", message: "That phone number is already in use" }],
  );

  // Role/active-status changes must take effect immediately, not whenever
  // the user's current access token happens to expire — revoke their
  // sessions so the next request re-authenticates with the new privileges.
  if (input.role !== undefined || input.isActive !== undefined) {
    await authRepository.revokeAllRefreshTokensForUser(id);
  }

  return updated;
}
