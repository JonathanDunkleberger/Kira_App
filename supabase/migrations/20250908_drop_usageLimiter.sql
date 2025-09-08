-- 20250908_drop_usageLimiter.sql
-- Safely drop legacy usage limiter artifacts if they ever existed.
-- All statements are IF EXISTS so this migration is idempotent/safe.

-- Functions
DROP FUNCTION IF EXISTS increment_daily_limit(uuid,int) CASCADE;
DROP FUNCTION IF EXISTS get_usage_limit(uuid) CASCADE;

-- Tables
DROP TABLE IF EXISTS usage_limits CASCADE;
DROP TABLE IF EXISTS usage_events CASCADE;

-- NOTE: We intentionally keep any profile columns (e.g. used_seconds_today, last_seconds_reset)
-- so historical data isn't lost; they are simply unused by the new heartbeat model.
