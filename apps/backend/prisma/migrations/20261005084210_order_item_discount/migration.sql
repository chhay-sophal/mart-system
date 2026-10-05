-- Item discount per sale line (total for the line, in the line's currency).
-- A plain ADD COLUMN rather than Prisma's generated table rebuild: same
-- result, no copy of OrderItem, and safe to run on Turso.
ALTER TABLE "OrderItem" ADD COLUMN "discountMinor" INTEGER NOT NULL DEFAULT 0;
