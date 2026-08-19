UPDATE "products" SET "barcode" = NULL WHERE "barcode" = '';

DROP INDEX "products_tenantId_barcode_idx";

CREATE UNIQUE INDEX "products_tenantId_barcode_key" ON "products"("tenantId", "barcode");
