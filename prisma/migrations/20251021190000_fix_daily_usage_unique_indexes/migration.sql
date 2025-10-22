-- Ensure DailyUsage unique constraints are compatible with Prisma upsert
-- Drop partial index (if present) and recreate standard unique index on (guestId, day)
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM pg_indexes WHERE schemaname = current_schema() AND indexname = 'DailyUsage_guestId_day_key'
  ) THEN
    EXECUTE 'DROP INDEX IF EXISTS "DailyUsage_guestId_day_key"';
  END IF;
END$$;

-- Create a standard unique index; Postgres allows multiple NULLs, but enforces uniqueness when guestId is non-NULL
CREATE UNIQUE INDEX IF NOT EXISTS "DailyUsage_guestId_day_key" ON "DailyUsage"("guestId", "day");

-- Ensure the userId/day unique index exists (idempotent)
CREATE UNIQUE INDEX IF NOT EXISTS "DailyUsage_userId_day_key" ON "DailyUsage"("userId", "day");
