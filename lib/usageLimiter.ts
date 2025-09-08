// lib/usageLimiter.ts
import { createClient } from '@supabase/supabase-js';

const supabaseAdmin = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!,
  { auth: { persistSession: false, autoRefreshToken: false } },
);

export interface UsageResult {
  used: number;
  remaining: number;
  limit: number;
  isPro: boolean;
  hasReachedLimit: boolean;
}

function dailyLimit(): number {
  return parseInt(process.env.DAILY_FREE_SECONDS_LIMIT || '300', 10);
}
function proLimit(): number {
  return parseInt(process.env.PRO_USER_CONVERSATION_SECONDS_LIMIT || '7200', 10);
}

function isResetNeeded(last: string | null | undefined): boolean {
  if (!last) return true;
  const t = Date.parse(last);
  if (!Number.isFinite(t)) return true;
  return Date.now() - t > 24 * 60 * 60 * 1000;
}

export async function getCurrentUsage(userId: string | null): Promise<UsageResult> {
  if (!userId) {
    return { used: 0, remaining: 0, limit: 0, isPro: false, hasReachedLimit: true };
  }
  const { data: profile, error } = await supabaseAdmin
    .from('profiles')
    .select('used_seconds_today, last_seconds_reset, subscription_status')
    .eq('user_id', userId)
    .maybeSingle();

  if (error) {
    console.error('[usageLimiter] fetch profile error', error);
    const limit = dailyLimit();
    return { used: limit, remaining: 0, limit, isPro: false, hasReachedLimit: true };
  }

  const isPro = (profile?.subscription_status || '') === 'active';
  const limit = isPro ? proLimit() : dailyLimit();
  let used = Number(profile?.used_seconds_today || 0);
  const last = profile?.last_seconds_reset as string | null;
  if (isResetNeeded(last)) {
    used = 0;
    await supabaseAdmin
      .from('profiles')
      .update({ used_seconds_today: 0, last_seconds_reset: new Date().toISOString() })
      .eq('user_id', userId);
  }
  const remaining = Math.max(0, limit - used);
  return { used, remaining, limit, isPro, hasReachedLimit: remaining <= 0 };
}

export async function checkAndIncrementUsage(
  userId: string,
  durationSeconds: number,
): Promise<UsageResult> {
  const current = await getCurrentUsage(userId);
  if (current.hasReachedLimit) return current;

  const inc = Math.max(0, Math.ceil(durationSeconds));
  const nextUsed = Math.min(current.limit, current.used + inc);
  if (userId) {
    const { error } = await supabaseAdmin
      .from('profiles')
      .update({ used_seconds_today: nextUsed })
      .eq('user_id', userId);
    if (error) console.error('[usageLimiter] increment error', error);
  }
  const remaining = Math.max(0, current.limit - nextUsed);
  return {
    used: nextUsed,
    remaining,
    limit: current.limit,
    isPro: current.isPro,
    hasReachedLimit: remaining <= 0,
  };
}
