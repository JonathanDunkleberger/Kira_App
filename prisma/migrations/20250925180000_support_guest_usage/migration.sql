/*
  Manual migration to support guest usage tracking.
  Changes:
  - DailyUsage.userId made nullable (already optional in Prisma schema)
  - Add DailyUsage.guestId nullable column
  - Add unique index on (guestId, day)
  - Adjust existing unique index (userId, day) to allow nullable userId (Postgres already treats NULL distinct)
  - Add Conversation.guestId nullable column
*/

-- Add guestId to DailyUsage if not exists
ALTER TABLE "DailyUsage" ADD COLUMN IF NOT EXISTS "guestId" TEXT;

-- Make userId nullable (if currently NOT NULL)
ALTER TABLE "DailyUsage" ALTER COLUMN "userId" DROP NOT NULL;

-- Add guestId/day unique index (only for non-null guestId)
-- Need to create a partial index to avoid multiple NULL entries conflict
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_indexes WHERE schemaname = current_schema() AND indexname = 'DailyUsage_guestId_day_key'
  ) THEN
    EXECUTE 'CREATE UNIQUE INDEX "DailyUsage_guestId_day_key" ON "DailyUsage"("guestId", "day") WHERE "guestId" IS NOT NULL';
  END IF;
END$$;

-- Conversation: add guestId column if not exists
ALTER TABLE "Conversation" ADD COLUMN IF NOT EXISTS "guestId" TEXT;

-- (Optional) Backfill isGuest flag if guestId is set and userId is null (no-op if column empty yet)
-- UPDATE "Conversation" SET "isGuest" = true WHERE "userId" IS NULL;

-- No foreign key for guestId as guests are anonymous.
