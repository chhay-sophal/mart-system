-- CreateTable
CREATE TABLE "BakongCredential" (
    "storeId" TEXT NOT NULL,
    "registeredEmail" TEXT,
    "apiToken" TEXT,
    "apiTokenUpdatedAt" TIMESTAMP(3),

    CONSTRAINT "BakongCredential_pkey" PRIMARY KEY ("storeId")
);

-- AddForeignKey
ALTER TABLE "BakongCredential" ADD CONSTRAINT "BakongCredential_storeId_fkey" FOREIGN KEY ("storeId") REFERENCES "Store"("id") ON DELETE CASCADE ON UPDATE CASCADE;
