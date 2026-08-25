import { afterAll, beforeAll } from "vitest";
import { prisma } from "../lib/prisma.ts";
import { deleteTrackedTenants } from "./fixtures.ts";

beforeAll(async () => {
  await prisma.$queryRaw`SELECT 1`;
});

afterAll(async () => {
  await deleteTrackedTenants();
  await prisma.$disconnect();
});
