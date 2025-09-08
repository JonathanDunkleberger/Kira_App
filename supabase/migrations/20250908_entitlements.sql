-- 20250908_entitlements.sql
-- New heartbeat-based usage schema: user_entitlements, daily_usage, chat_sessions, accrue_daily_usage()

CREATE TABLE IF NOT EXISTS user_entitlements (
  user_id uuid PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  plan text NOT NULL DEFAULT 'free', -- 'free' | 'supporter'
  pro_expires_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS daily_usage (
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  day date NOT NULL,
  seconds_used int NOT NULL DEFAULT 0,
  updated_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (user_id, day)
);

CREATE TABLE IF NOT EXISTS chat_sessions (
  id uuid PRIMARY KEY,
  user_id uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  seconds_elapsed int NOT NULL DEFAULT 0,
  title text
);

-- Helper: ensure row timestamps bump
CREATE OR REPLACE FUNCTION bump_updated_at() RETURNS trigger AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;$$ LANGUAGE plpgsql;

CREATE TRIGGER trg_user_entitlements_updated
  BEFORE UPDATE ON user_entitlements
  FOR EACH ROW EXECUTE FUNCTION bump_updated_at();

CREATE TRIGGER trg_daily_usage_updated
  BEFORE UPDATE ON daily_usage
  FOR EACH ROW EXECUTE FUNCTION bump_updated_at();

CREATE TRIGGER trg_chat_sessions_updated
  BEFORE UPDATE ON chat_sessions
  FOR EACH ROW EXECUTE FUNCTION bump_updated_at();

-- Limits (env driven in app, but keep defaults here for reference)
-- FREE_DAILY_LIMIT = 300 (5 min) ; PRO_CHAT_SESSION_LIMIT = 7200 (2h)

-- RPC: accrue_daily_usage(user_id uuid, session_id uuid, elapsed_increment int)
-- Atomically increments daily_usage and chat_sessions seconds, returns entitlement snapshot.
CREATE OR REPLACE FUNCTION accrue_daily_usage(p_user_id uuid, p_session_id uuid, p_inc int)
RETURNS TABLE (
  plan text,
  daily_seconds_used int,
  daily_seconds_limit int,
  session_seconds_elapsed int,
  session_seconds_limit int,
  hard_stop boolean,
  paywall boolean
) AS $$
DECLARE
  v_plan text;
  v_daily_limit int := 300;  -- default free daily limit
  v_session_limit int := 7200; -- default pro session cap
  v_is_pro boolean := false;
  v_day date := (now() at time zone 'utc')::date;
  v_daily_used int;
  v_session_elapsed int;
BEGIN
  SELECT COALESCE(plan,'free') INTO v_plan FROM user_entitlements WHERE user_id = p_user_id;
  v_is_pro := (v_plan = 'supporter');
  IF v_is_pro THEN
    v_daily_limit := 999999999; -- effectively unlimited for daily
  END IF;

  -- Upsert daily_usage
  INSERT INTO daily_usage(user_id, day, seconds_used)
  VALUES (p_user_id, v_day, 0)
  ON CONFLICT (user_id, day) DO NOTHING;

  -- Upsert chat session row
  INSERT INTO chat_sessions(id, user_id)
  VALUES (p_session_id, p_user_id)
  ON CONFLICT (id) DO NOTHING;

  -- Apply increments only if not exceeding
  UPDATE daily_usage
  SET seconds_used = LEAST(v_daily_limit, seconds_used + GREATEST(p_inc,0))
  WHERE user_id = p_user_id AND day = v_day
  RETURNING seconds_used INTO v_daily_used;

  UPDATE chat_sessions
  SET seconds_elapsed = seconds_elapsed + GREATEST(p_inc,0)
  WHERE id = p_session_id
  RETURNING seconds_elapsed INTO v_session_elapsed;

  IF v_session_elapsed IS NULL THEN
    SELECT seconds_elapsed INTO v_session_elapsed FROM chat_sessions WHERE id = p_session_id;
  END IF;

  RETURN QUERY SELECT
    v_plan,
    v_daily_used,
    v_daily_limit,
    v_session_elapsed,
    v_session_limit,
    (NOT v_is_pro AND v_daily_used >= v_daily_limit) OR (v_is_pro AND v_session_elapsed >= v_session_limit) AS hard_stop,
    (NOT v_is_pro AND v_daily_used >= v_daily_limit) AS paywall;
END;$$ LANGUAGE plpgsql SECURITY DEFINER;

-- Indexes for faster lookups
CREATE INDEX IF NOT EXISTS idx_daily_usage_day ON daily_usage(day);
CREATE INDEX IF NOT EXISTS idx_chat_sessions_user ON chat_sessions(user_id);

-- RLS (simplified; adjust policy names as needed)
ALTER TABLE user_entitlements ENABLE ROW LEVEL SECURITY;
ALTER TABLE daily_usage ENABLE ROW LEVEL SECURITY;
ALTER TABLE chat_sessions ENABLE ROW LEVEL SECURITY;

CREATE POLICY user_entitlements_select ON user_entitlements USING (auth.uid() = user_id);
CREATE POLICY user_entitlements_upsert ON user_entitlements
  FOR INSERT WITH CHECK (auth.uid() = user_id);
CREATE POLICY user_entitlements_update ON user_entitlements
  FOR UPDATE USING (auth.uid() = user_id);

CREATE POLICY daily_usage_select ON daily_usage USING (auth.uid() = user_id);
CREATE POLICY daily_usage_update ON daily_usage FOR UPDATE USING (auth.uid() = user_id);

CREATE POLICY chat_sessions_select ON chat_sessions USING (auth.uid() = user_id);
CREATE POLICY chat_sessions_update ON chat_sessions FOR UPDATE USING (auth.uid() = user_id);

