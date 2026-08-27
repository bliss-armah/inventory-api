import { app } from "./app";
import { env } from "./config/env";
import { prisma } from "./lib/prisma";
import { startScheduler } from "./lib/scheduler";
import { runLowStockDigestForAllTenants } from "./modules/alerts/alerts.jobs";
import { imageStorageBackend } from "./lib/image-store";

const server = app.listen(env.PORT, () => {
  console.log(`API listening on port ${env.PORT} (${env.NODE_ENV})`);
  console.log(`Product images: ${imageStorageBackend() === "r2" ? "Cloudflare R2" : "local disk (development only)"}`);
});

const LOW_STOCK_CHECK_MS = 60 * 60 * 1000;

const scheduler = startScheduler([
  {
    name: "low-stock-digest",
    everyMs: LOW_STOCK_CHECK_MS,
    run: async () => {
      await runLowStockDigestForAllTenants();
    },
  },
]);

async function shutdown(signal: string) {
  console.log(`Received ${signal}, shutting down gracefully...`);
  scheduler.stop();
  server.close(async () => {
    await prisma.$disconnect();
    process.exit(0);
  });
}

process.on("SIGTERM", () => void shutdown("SIGTERM"));
process.on("SIGINT", () => void shutdown("SIGINT"));
