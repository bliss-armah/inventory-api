ALTER TABLE "products" RENAME COLUMN "imageUrl" TO "imageKey";

UPDATE "products"
SET "imageKey" = 'products/' || substring("imageKey" from 10)
WHERE "imageKey" LIKE '/uploads/%';

UPDATE "products"
SET "imageKey" = substring("imageKey" from position('products/' in "imageKey"))
WHERE "imageKey" LIKE 'http%' AND position('products/' in "imageKey") > 0;

UPDATE "products"
SET "imageKey" = NULL
WHERE "imageKey" IS NOT NULL AND "imageKey" NOT LIKE 'products/%';
