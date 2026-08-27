ALTER TABLE "business_settings"
    ADD COLUMN "lowStockAlertsEnabled" BOOLEAN NOT NULL DEFAULT false;

CREATE TABLE "low_stock_alerts" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "productId" TEXT NOT NULL,
    "locationId" TEXT NOT NULL,
    "notifiedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "low_stock_alerts_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "low_stock_alerts_tenantId_productId_locationId_key"
    ON "low_stock_alerts"("tenantId", "productId", "locationId");
CREATE INDEX "low_stock_alerts_tenantId_idx" ON "low_stock_alerts"("tenantId");

ALTER TABLE "low_stock_alerts" ADD CONSTRAINT "low_stock_alerts_tenantId_fkey"
    FOREIGN KEY ("tenantId") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "low_stock_alerts" ADD CONSTRAINT "low_stock_alerts_productId_fkey"
    FOREIGN KEY ("productId") REFERENCES "products"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "low_stock_alerts" ADD CONSTRAINT "low_stock_alerts_locationId_fkey"
    FOREIGN KEY ("locationId") REFERENCES "locations"("id") ON DELETE CASCADE ON UPDATE CASCADE;
