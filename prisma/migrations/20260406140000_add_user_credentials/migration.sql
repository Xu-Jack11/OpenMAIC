-- AlterTable
ALTER TABLE "users" ADD COLUMN "account" TEXT;
ALTER TABLE "users" ADD COLUMN "passwordHash" TEXT;

-- CreateIndex
CREATE UNIQUE INDEX "users_account_key" ON "users"("account");
