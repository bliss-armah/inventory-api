import express from "express";
import cors from "cors";
import helmet from "helmet";
import compression from "compression";
import cookieParser from "cookie-parser";
import morgan from "morgan";
import { env, isProduction } from "./config/env";
import { errorHandler, notFoundHandler } from "./middleware/error-handler";
import { globalRateLimit } from "./middleware/rate-limit";
import { authRoutes } from "./modules/auth/auth.routes";
import { tenantsRoutes } from "./modules/tenants/tenants.routes";
import { usersRoutes } from "./modules/users/users.routes";
import { locationsRoutes } from "./modules/locations/locations.routes";
import { categoriesRoutes } from "./modules/categories/categories.routes";
import { brandsRoutes } from "./modules/brands/brands.routes";
import { suppliersRoutes } from "./modules/suppliers/suppliers.routes";
import { productsRoutes } from "./modules/products/products.routes";
import { inventoryRoutes } from "./modules/inventory/inventory.routes";
import { stockMovementsRoutes } from "./modules/stock-movements/stock-movements.routes";
import { stockAdjustmentsRoutes } from "./modules/stock-adjustments/stock-adjustments.routes";
import { purchaseOrdersRoutes } from "./modules/purchase-orders/purchase-orders.routes";
import { stockTransfersRoutes } from "./modules/stock-transfers/stock-transfers.routes";
import { stockCountsRoutes } from "./modules/stock-counts/stock-counts.routes";
import { reportsRoutes } from "./modules/reports/reports.routes";
import { activityRoutes } from "./modules/activity/activity.routes";
import { customersRoutes } from "./modules/customers/customers.routes";
import { shiftsRoutes } from "./modules/shifts/shifts.routes";
import { salesRoutes } from "./modules/sales/sales.routes";
import { dashboardRoutes } from "./modules/dashboard/dashboard.routes";
import { platformAuthRoutes } from "./modules/platform-auth/platform-auth.routes";
import { platformTenantsRoutes } from "./modules/platform-tenants/platform-tenants.routes";

export const app = express();

app.disable("x-powered-by");
app.set("trust proxy", 1);

app.use(helmet());
app.use(
  cors({
    origin: env.CORS_ORIGINS,
    credentials: true,
  }),
);
app.use(compression());
app.use(express.json({ limit: "2mb" }));
app.use(express.urlencoded({ extended: false }));
app.use(cookieParser(env.COOKIE_SECRET));
app.use(morgan(isProduction ? "combined" : "dev"));

app.get("/api/health", (_req, res) => {
  res.json({ success: true, data: { status: "ok" } });
});

app.use("/api", globalRateLimit);

app.use("/api/auth", authRoutes);
app.use("/api/tenants", tenantsRoutes);
app.use("/api/users", usersRoutes);
app.use("/api/locations", locationsRoutes);
app.use("/api/categories", categoriesRoutes);
app.use("/api/brands", brandsRoutes);
app.use("/api/suppliers", suppliersRoutes);
app.use("/api/products", productsRoutes);
app.use("/api/inventory", inventoryRoutes);
app.use("/api/stock-movements", stockMovementsRoutes);
app.use("/api/stock-adjustments", stockAdjustmentsRoutes);
app.use("/api/purchase-orders", purchaseOrdersRoutes);
app.use("/api/stock-transfers", stockTransfersRoutes);
app.use("/api/stock-counts", stockCountsRoutes);
app.use("/api/reports", reportsRoutes);
app.use("/api/activity", activityRoutes);
app.use("/api/customers", customersRoutes);
app.use("/api/shifts", shiftsRoutes);
app.use("/api/sales", salesRoutes);
app.use("/api/dashboard", dashboardRoutes);
app.use("/api/platform/auth", platformAuthRoutes);
app.use("/api/platform", platformTenantsRoutes);

app.use(notFoundHandler);
app.use(errorHandler);
