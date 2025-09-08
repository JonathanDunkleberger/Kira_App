-- 20250908_increment_chat_elapsed.sql
-- Adds atomic increment function for chat session elapsed seconds.
CREATE OR REPLACE FUNCTION increment_chat_elapsed(p_chat_id uuid, p_seconds int)
RETURNS void LANGUAGE sql SECURITY DEFINER AS $$
  UPDATE chat_sessions
     SET seconds_elapsed = seconds_elapsed + GREATEST(p_seconds,0)
   WHERE id = p_chat_id;
$$;
