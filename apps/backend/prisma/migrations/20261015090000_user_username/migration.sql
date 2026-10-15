-- AlterTable
ALTER TABLE "User" ADD COLUMN "username" TEXT;

-- Existing IMS accounts keep logging in with exactly what they typed before:
-- their username starts out as their (lowercased) email, and an admin can
-- rename it from the Staff page afterward. Cashier-only accounts have no
-- email and stay without a username.
UPDATE "User" SET "username" = lower("email") WHERE "email" IS NOT NULL;

-- CreateIndex
CREATE UNIQUE INDEX "User_username_key" ON "User"("username");
