-- AlterTable: add notification preferences storage to User
ALTER TABLE "User" ADD COLUMN "notificationPrefs" TEXT;
