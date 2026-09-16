-- Organization: the new tenant/subscription boundary above Store.
-- Backfill strategy: every existing Store/Product predates this concept, so
-- they all get attached to one "Default Organization" — this only matters
-- for today's already-seeded single-tenant data, new tenants get their own
-- Organization going forward.

-- CreateTable
CREATE TABLE "Organization" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Organization_pkey" PRIMARY KEY ("id")
);

INSERT INTO "Organization" ("id", "name", "isActive", "createdAt", "updatedAt")
VALUES ('default-organization', 'Default Organization', true, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP);

-- AlterTable: Store.organizationId, nullable first so existing rows backfill cleanly
ALTER TABLE "Store" ADD COLUMN "organizationId" TEXT;

UPDATE "Store" SET "organizationId" = 'default-organization' WHERE "organizationId" IS NULL;

ALTER TABLE "Store" ALTER COLUMN "organizationId" SET NOT NULL;

CREATE INDEX "Store_organizationId_idx" ON "Store"("organizationId");

ALTER TABLE "Store" ADD CONSTRAINT "Store_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AlterTable: Product.organizationId, backfilled from any StoreProduct's
-- store's organizationId (a Product with no StoreProduct at all falls back
-- to the default org too).
ALTER TABLE "Product" ADD COLUMN "organizationId" TEXT;

UPDATE "Product" p
SET "organizationId" = sp_org."organizationId"
FROM (
  SELECT DISTINCT sp."productId", s."organizationId"
  FROM "StoreProduct" sp
  JOIN "Store" s ON s."id" = sp."storeId"
) sp_org
WHERE p."id" = sp_org."productId";

UPDATE "Product" SET "organizationId" = 'default-organization' WHERE "organizationId" IS NULL;

ALTER TABLE "Product" ALTER COLUMN "organizationId" SET NOT NULL;

-- DropIndex: barcode was globally unique; replaced by an org-scoped constraint
DROP INDEX "Product_barcode_key";

CREATE UNIQUE INDEX "Product_organizationId_barcode_key" ON "Product"("organizationId", "barcode");

ALTER TABLE "Product" ADD CONSTRAINT "Product_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
