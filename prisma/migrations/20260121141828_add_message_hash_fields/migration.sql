-- AlterTable
ALTER TABLE "messages" ADD COLUMN     "isEncrypted" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "messageHash" TEXT;
