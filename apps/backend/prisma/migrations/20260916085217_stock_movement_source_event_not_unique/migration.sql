-- DropIndex
DROP INDEX "StockMovement_sourceEventId_key";

-- AlterTable
ALTER TABLE "StoreProduct" ALTER COLUMN "updatedAt" DROP DEFAULT;

-- CreateIndex
CREATE INDEX "StockMovement_sourceEventId_idx" ON "StockMovement"("sourceEventId");
