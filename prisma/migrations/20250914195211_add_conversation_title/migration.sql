/*
  Warnings:

  - The `plan` column on the `app_subscriptions` table would be dropped and recreated. This will lead to data loss if there is data in the column.
  - You are about to drop the `app_achievements` table. If the table is not empty, all the data it contains will be lost.
  - You are about to drop the `app_conversations` table. If the table is not empty, all the data it contains will be lost.
  - You are about to drop the `app_daily_usage` table. If the table is not empty, all the data it contains will be lost.
  - You are about to drop the `app_messages` table. If the table is not empty, all the data it contains will be lost.
  - You are about to drop the `app_user_achievements` table. If the table is not empty, all the data it contains will be lost.
  - You are about to drop the `app_users` table. If the table is not empty, all the data it contains will be lost.

*/
-- DropForeignKey
ALTER TABLE "public"."app_conversations" DROP CONSTRAINT "app_conversations_userId_fkey";

-- DropForeignKey
ALTER TABLE "public"."app_daily_usage" DROP CONSTRAINT "app_daily_usage_userId_fkey";

-- DropForeignKey
ALTER TABLE "public"."app_messages" DROP CONSTRAINT "app_messages_conversationId_fkey";

-- DropForeignKey
ALTER TABLE "public"."app_messages" DROP CONSTRAINT "app_messages_userId_fkey";

-- DropForeignKey
ALTER TABLE "public"."app_payment_events" DROP CONSTRAINT "app_payment_events_userId_fkey";

-- DropForeignKey
ALTER TABLE "public"."app_subscriptions" DROP CONSTRAINT "app_subscriptions_userId_fkey";

-- DropForeignKey
ALTER TABLE "public"."app_user_achievements" DROP CONSTRAINT "app_user_achievements_achievementId_fkey";

-- DropForeignKey
ALTER TABLE "public"."app_user_achievements" DROP CONSTRAINT "app_user_achievements_userId_fkey";

-- AlterTable
ALTER TABLE "public"."app_subscriptions" DROP COLUMN "plan",
ADD COLUMN     "plan" TEXT NOT NULL DEFAULT 'pro';

-- DropTable
DROP TABLE "public"."app_achievements";

-- DropTable
DROP TABLE "public"."app_conversations";

-- DropTable
DROP TABLE "public"."app_daily_usage";

-- DropTable
DROP TABLE "public"."app_messages";

-- DropTable
DROP TABLE "public"."app_user_achievements";

-- DropTable
DROP TABLE "public"."app_users";

-- DropEnum
DROP TYPE "public"."PlanTier";

-- CreateTable
CREATE TABLE "public"."User" (
    "id" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "tier" TEXT NOT NULL DEFAULT 'free',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "User_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "public"."Usage" (
    "id" TEXT NOT NULL,
    "userId" TEXT,
    "seconds" INTEGER NOT NULL,
    "date" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "ip" TEXT,

    CONSTRAINT "Usage_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "public"."Conversation" (
    "id" TEXT NOT NULL,
    "userId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "isGuest" BOOLEAN NOT NULL DEFAULT true,
    "title" TEXT NOT NULL DEFAULT 'New Conversation',

    CONSTRAINT "Conversation_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "public"."Message" (
    "id" TEXT NOT NULL,
    "conversationId" TEXT NOT NULL,
    "role" TEXT NOT NULL,
    "text" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Message_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "public"."Feedback" (
    "id" TEXT NOT NULL,
    "stars" INTEGER NOT NULL,
    "note" TEXT,
    "conversationId" TEXT,
    "userId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Feedback_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "User_id_key" ON "public"."User"("id");

-- CreateIndex
CREATE UNIQUE INDEX "User_email_key" ON "public"."User"("email");

-- AddForeignKey
ALTER TABLE "public"."Usage" ADD CONSTRAINT "Usage_userId_fkey" FOREIGN KEY ("userId") REFERENCES "public"."User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."Conversation" ADD CONSTRAINT "Conversation_userId_fkey" FOREIGN KEY ("userId") REFERENCES "public"."User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."Message" ADD CONSTRAINT "Message_conversationId_fkey" FOREIGN KEY ("conversationId") REFERENCES "public"."Conversation"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."Feedback" ADD CONSTRAINT "Feedback_conversationId_fkey" FOREIGN KEY ("conversationId") REFERENCES "public"."Conversation"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."app_subscriptions" ADD CONSTRAINT "app_subscriptions_userId_fkey" FOREIGN KEY ("userId") REFERENCES "public"."User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."app_payment_events" ADD CONSTRAINT "app_payment_events_userId_fkey" FOREIGN KEY ("userId") REFERENCES "public"."User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
