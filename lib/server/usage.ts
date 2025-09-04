// In lib/server/usage.ts
import { getSupabaseServerAdmin } from './supabaseAdmin.js';
import { FREE_TRIAL_SECONDS } from './env.server.js';
import { ensureEntitlements, getDailySecondsRemaining } from '../usage.js';

// Returns seconds remaining for a signed-in user or a guest conversation
export async function checkUsage(userId: string | null, guestId: string | null): Promise<number> {
  const supa = getSupabaseServerAdmin();
  const dailyLimit = FREE_TRIAL_SECONDS;

  // Signed-in user: use entitlements daily seconds remaining
  if (userId) {
    try {
      await ensureEntitlements(userId, dailyLimit);
      const remaining = await getDailySecondsRemaining(userId);
      return Math.max(0, Number(remaining ?? 0));
    } catch (e) {
      console.error('checkUsage user error:', e);
      return dailyLimit;
    }
  }

  // Guest: look up conversations.seconds_remaining (fallback to full daily limit)
  if (guestId) {
    try {
      const { data, error } = await supa
        .from('conversations')
        .select('seconds_remaining')
        .eq('id', guestId)
        .maybeSingle();
      if (error) return dailyLimit;
      const rem = Number(data?.seconds_remaining ?? dailyLimit);
      return Math.max(0, rem);
    } catch (e) {
      console.error('checkUsage guest error:', e);
      return dailyLimit;
    }
  }

  return dailyLimit;
}

export async function deductUsage(conversationId: string, secondsUsed: number) {
  if (!conversationId || !secondsUsed) return;

  const supa = getSupabaseServerAdmin();
  try {
    // This is a special Supabase function to call a database procedure.
    // We will create this procedure in the next step.
    const { error } = await supa.rpc('deduct_guest_usage', {
      p_conversation_id: conversationId,
      p_seconds_used: Math.ceil(secondsUsed)
    });

    if (error) {
      console.error('Error calling deduct_guest_usage:', error);
    } else {
      console.log(`[Usage] Successfully deducted ${secondsUsed.toFixed(2)} seconds.`);
    }
  } catch (e) {
    console.error('Exception during usage deduction:', e);
  }
}
