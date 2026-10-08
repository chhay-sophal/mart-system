/*
  Warnings:

  - Added the required column `updatedAt` to the `Order` table without a default value. This is not possible if the table is not empty.

*/
-- RedefineTables
PRAGMA defer_foreign_keys=ON;
PRAGMA foreign_keys=OFF;
CREATE TABLE "new_Order" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "storeId" TEXT NOT NULL,
    "terminalId" TEXT NOT NULL,
    "clientOrderUuid" TEXT NOT NULL,
    "customerId" TEXT,
    "cashierUserId" TEXT,
    "totalAmountMinor" INTEGER NOT NULL,
    "currency" TEXT NOT NULL,
    "paymentMethod" TEXT NOT NULL,
    "bankName" TEXT,
    "amountPaidUsdMinor" INTEGER NOT NULL DEFAULT 0,
    "amountPaidKhrMinor" INTEGER NOT NULL DEFAULT 0,
    "changeGivenKhrMinor" INTEGER NOT NULL DEFAULT 0,
    "status" TEXT NOT NULL DEFAULT 'COMPLETED',
    "isDeleted" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" DATETIME NOT NULL,
    "updatedAt" DATETIME NOT NULL,
    "syncedAt" DATETIME,
    CONSTRAINT "Order_storeId_fkey" FOREIGN KEY ("storeId") REFERENCES "Store" ("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "Order_terminalId_fkey" FOREIGN KEY ("terminalId") REFERENCES "Terminal" ("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "Order_cashierUserId_fkey" FOREIGN KEY ("cashierUserId") REFERENCES "User" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);
-- Backfill existing rows' updatedAt from createdAt (no update has happened
-- yet as far as we know) rather than "now", so a historical order doesn't
-- look like it just changed and get pulled as a false delta.
INSERT INTO "new_Order" ("amountPaidKhrMinor", "amountPaidUsdMinor", "bankName", "cashierUserId", "changeGivenKhrMinor", "clientOrderUuid", "createdAt", "currency", "customerId", "id", "isDeleted", "paymentMethod", "status", "storeId", "syncedAt", "terminalId", "totalAmountMinor", "updatedAt") SELECT "amountPaidKhrMinor", "amountPaidUsdMinor", "bankName", "cashierUserId", "changeGivenKhrMinor", "clientOrderUuid", "createdAt", "currency", "customerId", "id", "isDeleted", "paymentMethod", "status", "storeId", "syncedAt", "terminalId", "totalAmountMinor", "createdAt" FROM "Order";
DROP TABLE "Order";
ALTER TABLE "new_Order" RENAME TO "Order";
CREATE UNIQUE INDEX "Order_clientOrderUuid_key" ON "Order"("clientOrderUuid");
CREATE INDEX "Order_storeId_createdAt_idx" ON "Order"("storeId", "createdAt");
CREATE INDEX "Order_storeId_updatedAt_idx" ON "Order"("storeId", "updatedAt");
PRAGMA foreign_keys=ON;
PRAGMA defer_foreign_keys=OFF;
