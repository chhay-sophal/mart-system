-- CreateIndex
CREATE INDEX "Product_updatedAt_idx" ON "Product"("updatedAt");

-- CreateIndex
CREATE INDEX "Category_updatedAt_idx" ON "Category"("updatedAt");

-- CreateIndex
CREATE INDEX "StoreProduct_storeId_updatedAt_idx" ON "StoreProduct"("storeId", "updatedAt");

