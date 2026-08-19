import { afterAll } from "vitest";
import { deleteTrackedTenants } from "./fixtures.ts";

afterAll(async () => {
  await deleteTrackedTenants();
});
