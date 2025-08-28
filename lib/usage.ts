import { getSupabaseServerAdmin } from './supabaseAdmin';

export async function ensureEntitlements(userId: string, initialSeconds?: number) {
  const seconds = typeof initialSeconds === 'number'
    ? initialSeconds
    : parseInt(process.env.FREE_TRIAL_SECONDS || '600', 10);
  const sb = getSupabaseServerAdmin();
  const { data } = await sb.from('entitlements').select('user_id').eq('user_id', userId).maybeSingle();
  if (!data) {
    await sb.from('entitlements').insert({ user_id: userId, seconds_remaining: seconds, plan: 'free' });
  }
}

export async function getSecondsRemaining(userId: string): Promise<number> {
  const sb = getSupabaseServerAdmin();
  const { data, error } = await sb.from('entitlements').select('seconds_remaining').eq('user_id', userId).maybeSingle();
  if (error) throw error;
  return data?.seconds_remaining ?? 0;
}

export async function decrementSeconds(userId: string, seconds: number) {
  const sb = getSupabaseServerAdmin();
  await sb.rpc('decrement_seconds', { p_user_id: userId, p_seconds: seconds });
}

export async function addSupporter(userId: string) { // Removed 'minutes' argument
  const sb = getSupabaseServerAdmin();
  await sb.from('entitlements').upsert({
    user_id: userId,
    plan: 'supporter',
    seconds_remaining: 999999999 // Grant a huge number for "unlimited"
  });
}

export async function bumpUsage(
  userId: string,
  seconds_stt: number,
  seconds_tts: number,
  tokens_in: number,
  tokens_out: number,
  chars_tts: number
) {
  const sb = getSupabaseServerAdmin();
  await sb.rpc('bump_usage', { p_user_id: userId, p_seconds_stt: seconds_stt, p_seconds_tts: seconds_tts, p_tokens_in: tokens_in, p_tokens_out: tokens_out, p_chars_tts: chars_tts });
}