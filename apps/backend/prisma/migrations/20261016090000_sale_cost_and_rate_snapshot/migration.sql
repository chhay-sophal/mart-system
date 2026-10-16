-- Snapshot the exchange rate on each sale and the unit cost on each sale line,
-- so reports stop recomputing past days with today's rate and cost.
-- Plain ADD COLUMNs (nullable, no backfill): existing rows have no recorded
-- snapshot, and reports fall back to the current rate/cost for them.
ALTER TABLE "Order" ADD COLUMN "exchangeRate" REAL;
ALTER TABLE "OrderItem" ADD COLUMN "costAtSaleMinor" INTEGER;
ALTER TABLE "OrderItem" ADD COLUMN "costCurrency" TEXT;
