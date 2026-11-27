-- CreateTable
CREATE TABLE "IssuedKhqr" (
    "md5Hash" TEXT NOT NULL PRIMARY KEY,
    "storeId" TEXT NOT NULL,
    "terminalId" TEXT,
    "qrString" TEXT NOT NULL,
    "accountId" TEXT NOT NULL,
    "currency" TEXT NOT NULL,
    "amountMinor" INTEGER NOT NULL,
    "expiresAt" DATETIME NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'PENDING',
    "paidAt" DATETIME,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "IssuedKhqr_storeId_fkey" FOREIGN KEY ("storeId") REFERENCES "Store" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateIndex
CREATE INDEX "IssuedKhqr_storeId_status_idx" ON "IssuedKhqr"("storeId", "status");

