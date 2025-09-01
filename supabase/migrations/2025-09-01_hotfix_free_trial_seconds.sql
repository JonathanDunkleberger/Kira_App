-- Hotfix: align existing free users to current FREE_TRIAL_SECONDS
-- IMPORTANT: Replace 10 with the correct FREE_TRIAL_SECONDS value from your environment before running locally.
-- Safer WHERE: limit to free or non-active plans.

BEGIN;
  UPDATE public.entitlements
  SET
    trial_seconds_per_day = 10,
    trial_seconds_remaining = 10,
    trial_last_reset = CURRENT_DATE
  WHERE (plan = 'free' OR status != 'active');
COMMIT;
