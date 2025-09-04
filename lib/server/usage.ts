// In lib/server/usage.ts
import { getSupabaseServerAdmin } from '@/lib/server/supabaseAdmin';
import { FREE_TRIAL_SECONDS } from '@/lib/server/env.server';

// Returns seconds remaining for a signed-in user or a guest conversation
export async function checkUsage(userId: string | null, guestId: string | null): Promise<number> {
  const supa = getSupabaseServerAdmin();
  const dailyLimit = FREE_TRIAL_SECONDS;

  // Logic for SIGNED-IN users
  if (userId) {
    try {
      const { data, error } = await supa
        .from('profiles')
        .select('daily_seconds_used')
        .eq('id', userId)
        .single();
      if (error) throw error;
      const secondsUsed = (data as any)?.daily_seconds_used || 0;
      return Math.max(0, dailyLimit - secondsUsed);
    } catch (e) {
      console.error('checkUsage for signed-in user failed:', e);
      return dailyLimit;
    }
  }

  // Logic for GUEST users
  if (guestId) {
    try {
      const { data, error } = await supa
        .from('conversations')
        .select('guest_seconds_used')
        .eq('id', guestId)
        .single();
      if (error) throw error;
      const secondsUsed = (data as any)?.guest_seconds_used || 0;
      return Math.max(0, dailyLimit - secondsUsed);
    } catch (e) {
      console.error('checkUsage for guest failed:', e);
      return dailyLimit;
    }
  }

  // If no one is identified, return the full limit
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
