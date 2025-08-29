import { getSupabaseServerAdmin } from './supabaseAdmin';
import { FREE_TRIAL_SECONDS } from './env';

/**
 * Ensure a row exists and daily counters are initialized.
 * FREE_TRIAL_SECONDS now means "per day".
 */
export async function ensureEntitlements(userId: string, perDay: number = FREE_TRIAL_SECONDS) {
  const sb = getSupabaseServerAdmin();

  // Create row if missing
  const { data } = await sb.from('entitlements').select('user_id').eq('user_id', userId).maybeSingle();
  if (!data) {
    await sb.from('entitlements').insert({
      user_id: userId,
      plan: 'free',
      status: 'inactive',
      trial_seconds_per_day: perDay,
      trial_last_reset: new Date().toISOString().slice(0, 10), // YYYY-MM-DD UTC date
      trial_seconds_remaining: perDay
    });
    return;
  }

  // Reset daily if date changed (UTC)
  const today = new Date().toISOString().slice(0, 10);
  const { data: entRow } = await sb
    .from('entitlements')
    .select('trial_last_reset, trial_seconds_per_day, trial_seconds_remaining')
    .eq('user_id', userId)
    .maybeSingle();

  const perDayValue = entRow?.trial_seconds_per_day ?? perDay;
  if (!entRow?.trial_last_reset || entRow.trial_last_reset !== today) {
    await sb.from('entitlements').update({
      trial_last_reset: today,
      trial_seconds_per_day: perDayValue,
      trial_seconds_remaining: perDayValue
    }).eq('user_id', userId);
  }
}

export async function getEntitlement(userId: string) {
  const sb = getSupabaseServerAdmin();
  const { data } = await sb
    .from('entitlements')
    .select('status, plan, trial_seconds_remaining, trial_last_reset, trial_seconds_per_day')
    .eq('user_id', userId)
    .maybeSingle();

  // Fallbacks keep API stable
  return {
    status: (data?.status ?? 'inactive') as 'inactive'|'active'|'past_due'|'canceled',
    plan: (data?.plan ?? 'free') as 'free'|'supporter',
    trial_seconds_remaining: data?.trial_seconds_remaining ?? 0,
    trial_last_reset: data?.trial_last_reset ?? new Date().toISOString().slice(0, 10),
    trial_seconds_per_day: data?.trial_seconds_per_day ?? FREE_TRIAL_SECONDS,
  };
}

/** Remaining daily seconds (after ensuring reset). */
export async function getDailySecondsRemaining(userId: string): Promise<number> {
  await ensureEntitlements(userId, FREE_TRIAL_SECONDS);
  const ent = await getEntitlement(userId);
  return ent.trial_seconds_remaining;
}

/** Decrement daily seconds (no-op for Pro). */
export async function decrementDailySeconds(userId: string, seconds: number) {
  const sb = getSupabaseServerAdmin();
  await ensureEntitlements(userId, FREE_TRIAL_SECONDS);
  const ent = await getEntitlement(userId);
  if (ent.status === 'active') return; // Pro users don’t decrement

  const newVal = Math.max(0, (ent.trial_seconds_remaining ?? 0) - seconds);
  await sb.from('entitlements').update({ trial_seconds_remaining: newVal }).eq('user_id', userId);
}

/** Keep your existing Pro-grant semantics. */
export async function setPro(userId: string, opts?: {
  stripeCustomerId?: string;
  stripeSubscriptionId?: string;
  status?: 'active'|'past_due'|'canceled';
}) {
  const sb = getSupabaseServerAdmin();
  await sb.from('entitlements').upsert({
    user_id: userId,
    plan: 'supporter',
    status: opts?.status ?? 'active',
    stripe_customer_id: opts?.stripeCustomerId,
    stripe_subscription_id: opts?.stripeSubscriptionId
  });
}