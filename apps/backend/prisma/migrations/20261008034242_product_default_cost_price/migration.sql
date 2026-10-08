-- RedefineTables
PRAGMA defer_foreign_keys=ON;
PRAGMA foreign_keys=OFF;
CREATE TABLE "new_Product" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "barcode" TEXT,
    "name" TEXT NOT NULL,
    "category" TEXT,
    "defaultPriceMinor" INTEGER NOT NULL,
    "defaultCostPriceMinor" INTEGER NOT NULL DEFAULT 0,
    "currency" TEXT NOT NULL DEFAULT 'USD',
    "supplierId" TEXT,
    "isDeleted" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "Product_supplierId_fkey" FOREIGN KEY ("supplierId") REFERENCES "Supplier" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);
INSERT INTO "new_Product" ("barcode", "category", "createdAt", "currency", "defaultPriceMinor", "id", "isDeleted", "name", "supplierId", "updatedAt") SELECT "barcode", "category", "createdAt", "currency", "defaultPriceMinor", "id", "isDeleted", "name", "supplierId", "updatedAt" FROM "Product";
DROP TABLE "Product";
ALTER TABLE "new_Product" RENAME TO "Product";
CREATE UNIQUE INDEX "Product_barcode_key" ON "Product"("barcode");
CREATE INDEX "Product_supplierId_idx" ON "Product"("supplierId");
PRAGMA foreign_keys=ON;
PRAGMA defer_foreign_keys=OFF;
