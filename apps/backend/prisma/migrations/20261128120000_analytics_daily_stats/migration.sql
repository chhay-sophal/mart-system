-- CreateTable
CREATE TABLE "DailyStoreStat" (
    "storeId" TEXT NOT NULL,
    "date" TEXT NOT NULL,
    "orderCount" INTEGER NOT NULL,
    "revenueMinor" INTEGER NOT NULL,
    "revenueKhr" INTEGER NOT NULL,
    "grossProfitMinor" INTEGER NOT NULL,
    "grossProfitKhr" INTEGER NOT NULL,
    "hourly" TEXT NOT NULL,
    "stale" BOOLEAN NOT NULL DEFAULT false,
    "updatedAt" DATETIME NOT NULL,

    PRIMARY KEY ("storeId", "date"),
    CONSTRAINT "DailyStoreStat_storeId_fkey" FOREIGN KEY ("storeId") REFERENCES "Store" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "DailyProductStat" (
    "storeId" TEXT NOT NULL,
    "date" TEXT NOT NULL,
    "productId" TEXT NOT NULL,
    "quantity" INTEGER NOT NULL,
    "revenueMinor" INTEGER NOT NULL,
    "revenueKhr" INTEGER NOT NULL,

    PRIMARY KEY ("storeId", "date", "productId"),
    CONSTRAINT "DailyProductStat_storeId_fkey" FOREIGN KEY ("storeId") REFERENCES "Store" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "StatsCursor" (
    "storeId" TEXT NOT NULL PRIMARY KEY,
    "computedThrough" DATETIME NOT NULL,
    CONSTRAINT "StatsCursor_storeId_fkey" FOREIGN KEY ("storeId") REFERENCES "Store" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

