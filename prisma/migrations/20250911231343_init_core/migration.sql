/*
  Warnings:

  - You are about to drop the column `sender` on the `app_messages` table. All the data in the column will be lost.
  - You are about to drop the column `tier` on the `app_users` table. All the data in the column will be lost.
  - You are about to drop the `app_usage` table. If the table is not empty, all the data it contains will be lost.
  - Added the required column `role` to the `app_messages` table without a default value. This is not possible if the table is not empty.
  - Added the required column `updatedAt` to the `app_users` table without a default value. This is not possible if the table is not empty.

*/
-- CreateEnum
CREATE TYPE "public"."PlanTier" AS ENUM ('FREE', 'PRO');

-- DropForeignKey
ALTER TABLE "public"."app_usage" DROP CONSTRAINT "app_usage_userId_fkey";

-- AlterTable
ALTER TABLE "public"."app_messages" DROP COLUMN "sender",
ADD COLUMN     "role" TEXT NOT NULL,
ADD COLUMN     "userId" TEXT;

-- AlterTable
ALTER TABLE "public"."app_users" DROP COLUMN "tier",
ADD COLUMN     "plan" "public"."PlanTier" NOT NULL DEFAULT 'FREE',
ADD COLUMN     "updatedAt" TIMESTAMP(3) NOT NULL;

-- DropTable
DROP TABLE "public"."app_usage";

-- CreateTable
CREATE TABLE "public"."app_daily_usage" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "day" TIMESTAMP(3) NOT NULL,
    "seconds" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "app_daily_usage_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "public"."app_subscriptions" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "stripeCustomer" TEXT,
    "stripeSubId" TEXT,
    "status" TEXT NOT NULL DEFAULT 'inactive',
    "plan" "public"."PlanTier" NOT NULL DEFAULT 'PRO',
    "currentPeriodEnd" TIMESTAMP(3),
    "cancelAt" TIMESTAMP(3),
    "canceledAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "app_subscriptions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "public"."app_payment_events" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "stripeId" TEXT NOT NULL,
    "type" TEXT NOT NULL,
    "status" TEXT,
    "amountCents" INTEGER,
    "currency" TEXT DEFAULT 'usd',
    "raw" JSONB NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "app_payment_events_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "public"."app_achievements" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "app_achievements_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "public"."app_user_achievements" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "achievementId" TEXT NOT NULL,
    "earnedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "app_user_achievements_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "app_daily_usage_day_idx" ON "public"."app_daily_usage"("day");

-- CreateIndex
CREATE UNIQUE INDEX "app_daily_usage_userId_day_key" ON "public"."app_daily_usage"("userId", "day");

-- CreateIndex
CREATE UNIQUE INDEX "app_subscriptions_stripeCustomer_key" ON "public"."app_subscriptions"("stripeCustomer");

-- CreateIndex
CREATE UNIQUE INDEX "app_subscriptions_stripeSubId_key" ON "public"."app_subscriptions"("stripeSubId");

-- CreateIndex
CREATE INDEX "app_subscriptions_userId_idx" ON "public"."app_subscriptions"("userId");

-- CreateIndex
CREATE UNIQUE INDEX "app_payment_events_stripeId_key" ON "public"."app_payment_events"("stripeId");

-- CreateIndex
CREATE INDEX "app_payment_events_userId_createdAt_idx" ON "public"."app_payment_events"("userId", "createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "app_user_achievements_userId_achievementId_key" ON "public"."app_user_achievements"("userId", "achievementId");

-- CreateIndex
CREATE INDEX "app_conversations_userId_createdAt_idx" ON "public"."app_conversations"("userId", "createdAt");

-- CreateIndex
CREATE INDEX "app_messages_conversationId_createdAt_idx" ON "public"."app_messages"("conversationId", "createdAt");

-- AddForeignKey
ALTER TABLE "public"."app_daily_usage" ADD CONSTRAINT "app_daily_usage_userId_fkey" FOREIGN KEY ("userId") REFERENCES "public"."app_users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."app_messages" ADD CONSTRAINT "app_messages_userId_fkey" FOREIGN KEY ("userId") REFERENCES "public"."app_users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."app_subscriptions" ADD CONSTRAINT "app_subscriptions_userId_fkey" FOREIGN KEY ("userId") REFERENCES "public"."app_users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."app_payment_events" ADD CONSTRAINT "app_payment_events_userId_fkey" FOREIGN KEY ("userId") REFERENCES "public"."app_users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."app_user_achievements" ADD CONSTRAINT "app_user_achievements_userId_fkey" FOREIGN KEY ("userId") REFERENCES "public"."app_users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."app_user_achievements" ADD CONSTRAINT "app_user_achievements_achievementId_fkey" FOREIGN KEY ("achievementId") REFERENCES "public"."app_achievements"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
