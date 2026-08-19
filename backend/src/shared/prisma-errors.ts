import { Prisma } from "../generated/prisma/client.ts";
import { BadRequestError, ConflictError } from "./errors.ts";

/**
 * Runs a Prisma write and turns a unique-constraint violation (P2002) into a
 * domain-level ConflictError instead of a raw 500. Any other error propagates
 * unchanged so it still hits the centralized error handler as-is.
 */
export function isUniqueViolation(error: unknown): boolean {
  return (
    error instanceof Prisma.PrismaClientKnownRequestError &&
    error.code === "P2002"
  );
}

type UniqueConflict = { field: string; message: string; match?: string };

function describeTarget(error: Prisma.PrismaClientKnownRequestError): string {
  const target = error.meta?.target;
  const fromMeta = Array.isArray(target)
    ? target.join(",")
    : typeof target === "string"
      ? target
      : "";
  return `${fromMeta} ${error.message}`;
}

export async function withUniqueConstraints<T>(
  run: () => Promise<T>,
  conflicts: [UniqueConflict, ...UniqueConflict[]],
): Promise<T> {
  try {
    return await run();
  } catch (error) {
    if (isUniqueViolation(error)) {
      const target = describeTarget(
        error as Prisma.PrismaClientKnownRequestError,
      );
      const matched =
        conflicts.find(
          (conflict) => conflict.match && target.includes(conflict.match),
        ) ?? conflicts[0];
      throw new ConflictError(matched.message, {
        [matched.field]: [matched.message],
      });
    }
    if (
      error instanceof Prisma.PrismaClientKnownRequestError &&
      error.code === "P2003"
    ) {
      throw new BadRequestError("Referenced record does not exist");
    }
    throw error;
  }
}

export async function withUniqueConstraint<T>(
  run: () => Promise<T>,
  onConflict: { field: string; message: string },
): Promise<T> {
  try {
    return await run();
  } catch (error) {
    if (
      error instanceof Prisma.PrismaClientKnownRequestError &&
      error.code === "P2002"
    ) {
      throw new ConflictError(onConflict.message, {
        [onConflict.field]: [onConflict.message],
      });
    }
    if (
      error instanceof Prisma.PrismaClientKnownRequestError &&
      error.code === "P2003"
    ) {
      throw new BadRequestError("Referenced record does not exist");
    }
    throw error;
  }
}
