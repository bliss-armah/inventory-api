import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    // These tests hit a real Postgres instance (tenant fixtures, concurrent
    // HTTP requests via supertest) rather than mocking it — the default 5s
    // budget is too tight once fixture setup and 20-way concurrency are
    // included.
    testTimeout: 30_000,
    hookTimeout: 30_000,
    // Cross-tenant and concurrency suites both hit shared tables; running
    // test files in parallel workers risks cross-file interference on the
    // same DB, so keep it to one file at a time.
    fileParallelism: false,
  },
});
