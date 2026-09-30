-- Online orders for the storefront (docs/online-orders-plan.md, build step 4).
-- Only PaymentTransaction is rebuilt (to make orderId optional). No table references it,
-- so dropping it can't cascade into other data even where PRAGMA foreign_keys=OFF is ignored.
-- CreateTable
CREATE TABLE "OnlineOrder" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "storeId" TEXT NOT NULL,
    "publicToken" TEXT NOT NULL,
    "clientOrderUuid" TEXT NOT NULL,
    "pickupCode" TEXT NOT NULL,
    "status" TEXT NOT NULL,
    "paymentMethod" TEXT NOT NULL,
    "collectedPaymentMethod" TEXT,
    "customerName" TEXT NOT NULL,
    "customerPhone" TEXT NOT NULL,
    "note" TEXT,
    "pickupAt" DATETIME,
    "holdUntil" DATETIME,
    "paymentExpiresAt" DATETIME,
    "lastPaymentCheckAt" DATETIME,
    "totalAmountMinor" INTEGER NOT NULL,
    "currency" TEXT NOT NULL DEFAULT 'USD',
    "exchangeRate" REAL NOT NULL,
    "cancelReason" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    "paidAt" DATETIME,
    "readyAt" DATETIME,
    "collectedAt" DATETIME,
    "cancelledAt" DATETIME,
    CONSTRAINT "OnlineOrder_storeId_fkey" FOREIGN KEY ("storeId") REFERENCES "Store" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "OnlineOrderItem" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "onlineOrderId" TEXT NOT NULL,
    "productId" TEXT NOT NULL,
    "nameAtOrder" TEXT NOT NULL,
    "quantity" INTEGER NOT NULL,
    "priceAtOrderMinor" INTEGER NOT NULL,
    "currency" TEXT NOT NULL,
    CONSTRAINT "OnlineOrderItem_onlineOrderId_fkey" FOREIGN KEY ("onlineOrderId") REFERENCES "OnlineOrder" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "OnlineOrderItem_productId_fkey" FOREIGN KEY ("productId") REFERENCES "Product" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);

-- RedefineTables
PRAGMA defer_foreign_keys=ON;
PRAGMA foreign_keys=OFF;
CREATE TABLE "new_PaymentTransaction" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "orderId" TEXT,
    "onlineOrderId" TEXT,
    "md5Hash" TEXT NOT NULL,
    "qrString" TEXT NOT NULL,
    "bankName" TEXT,
    "currency" TEXT NOT NULL,
    "amountMinor" INTEGER NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'PENDING',
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "PaymentTransaction_orderId_fkey" FOREIGN KEY ("orderId") REFERENCES "Order" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "PaymentTransaction_onlineOrderId_fkey" FOREIGN KEY ("onlineOrderId") REFERENCES "OnlineOrder" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);
INSERT INTO "new_PaymentTransaction" ("amountMinor", "bankName", "createdAt", "currency", "id", "md5Hash", "orderId", "qrString", "status", "updatedAt") SELECT "amountMinor", "bankName", "createdAt", "currency", "id", "md5Hash", "orderId", "qrString", "status", "updatedAt" FROM "PaymentTransaction";
DROP TABLE "PaymentTransaction";
ALTER TABLE "new_PaymentTransaction" RENAME TO "PaymentTransaction";
CREATE UNIQUE INDEX "PaymentTransaction_md5Hash_key" ON "PaymentTransaction"("md5Hash");
CREATE INDEX "PaymentTransaction_onlineOrderId_idx" ON "PaymentTransaction"("onlineOrderId");
PRAGMA foreign_keys=ON;
PRAGMA defer_foreign_keys=OFF;

-- CreateIndex
CREATE UNIQUE INDEX "OnlineOrder_publicToken_key" ON "OnlineOrder"("publicToken");

-- CreateIndex
CREATE UNIQUE INDEX "OnlineOrder_clientOrderUuid_key" ON "OnlineOrder"("clientOrderUuid");

-- CreateIndex
CREATE INDEX "OnlineOrder_storeId_status_idx" ON "OnlineOrder"("storeId", "status");

-- CreateIndex
CREATE INDEX "OnlineOrder_storeId_collectedAt_idx" ON "OnlineOrder"("storeId", "collectedAt");

-- CreateIndex
CREATE INDEX "OnlineOrder_status_holdUntil_idx" ON "OnlineOrder"("status", "holdUntil");

-- CreateIndex
CREATE INDEX "OnlineOrder_status_paymentExpiresAt_idx" ON "OnlineOrder"("status", "paymentExpiresAt");

-- CreateIndex
CREATE INDEX "OnlineOrderItem_onlineOrderId_idx" ON "OnlineOrderItem"("onlineOrderId");

