-- Opening hours and map location for the public storefront (docs/storefront-plan.md, build step 3).
-- AlterTable
ALTER TABLE "Store" ADD COLUMN "latitude" REAL;
ALTER TABLE "Store" ADD COLUMN "longitude" REAL;
ALTER TABLE "Store" ADD COLUMN "openingHours" JSONB;
