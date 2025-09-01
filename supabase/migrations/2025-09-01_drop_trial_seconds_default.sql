-- Drop default 900 from entitlements.trial_seconds_per_day
-- Rationale: Server-side FREE_TRIAL_SECONDS is the single source of truth.
-- This prevents drift between DB defaults and app-configured limits.

alter table if exists public.entitlements
  alter column trial_seconds_per_day drop default;

-- Optionally, normalize any rows with NULL by setting to current FREE_TRIAL_SECONDS at runtime
-- via server ensureEntitlements(). We intentionally do not backfill here to keep DB neutral.
