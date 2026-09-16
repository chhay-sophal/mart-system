/*
  Warnings:

  - Added the required column `updatedAt` to the `StoreProduct` table without a default value. This is not possible if the table is not empty.

*/
-- AlterTable
ALTER TABLE "StoreProduct" ADD COLUMN     "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP;
