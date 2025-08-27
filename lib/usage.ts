import { getSupabaseServerAdmin } from './supabaseAdmin';
import { FREE_TRIAL_SECONDS } from './env';

export async function ensureEntitlements(userId: string, initialSeconds: number = FREE_TRIAL_SECONDS) {
  const sb = getSupabaseServerAdmin();
  const { data } = await sb.from('entitlements').select('user_id').eq('user_id', userId).maybeSingle();
  if (!data) {
    await sb.from('entitlements').insert({ user_id: userId, seconds_remaining: initialSeconds, plan: 'free' });
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

export async function addSupporter(userId: string, minutes: number = 1000) {
  const sb = getSupabaseServerAdmin();
  await sb.from('entitlements').upsert({
    user_id: userId,
    plan: 'supporter',
    seconds_remaining: minutes * 60
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
