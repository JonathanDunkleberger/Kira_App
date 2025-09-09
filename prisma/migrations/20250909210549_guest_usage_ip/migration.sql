-- DropForeignKey
ALTER TABLE "public"."app_usage" DROP CONSTRAINT "app_usage_userId_fkey";

-- AlterTable
ALTER TABLE "public"."app_usage" ADD COLUMN     "ip" TEXT,
ALTER COLUMN "userId" DROP NOT NULL;

-- CreateIndex
CREATE INDEX "app_usage_userId_date_idx" ON "public"."app_usage"("userId", "date");

-- CreateIndex
CREATE INDEX "app_usage_ip_date_idx" ON "public"."app_usage"("ip", "date");

-- AddForeignKey
ALTER TABLE "public"."app_usage" ADD CONSTRAINT "app_usage_userId_fkey" FOREIGN KEY ("userId") REFERENCES "public"."app_users"("id") ON DELETE SET NULL ON UPDATE CASCADE;
