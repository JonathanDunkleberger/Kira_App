// In lib/server/usage.ts
import { getSupabaseServerAdmin } from '@/lib/server/supabaseAdmin';
import { FREE_TRIAL_SECONDS } from '@/lib/server/env.server';
// (no import of entitlement helpers; this module directly checks usage columns)

// Returns seconds remaining for a signed-in user or a guest conversation
export async function checkUsage(userId: string | null, guestId: string | null): Promise<number> {
  const supa = getSupabaseServerAdmin();
  const dailyLimit = FREE_TRIAL_SECONDS;

  // Logic for SIGNED-IN users
  if (userId) {
    try {
      // Look at the 'daily_seconds_used' column in the 'profiles' table
      const { data, error } = await supa
        .from('profiles')
        .select('daily_seconds_used')
        .eq('id', userId)
        .single();

      if (error) throw error;

      const secondsUsed = (data as any)?.daily_seconds_used || 0;
      return Math.max(0, dailyLimit - secondsUsed);
    } catch (e) {
      console.error('checkUsage user error:', e);
      return dailyLimit; // Fallback on error
    }
  }

  // Logic for GUEST users
  if (guestId) {
    try {
      // Look at the 'guest_seconds_used' column in the 'conversations' table
      const { data, error } = await supa
        .from('conversations')
        .select('guest_seconds_used')
        .eq('id', guestId)
        .single();

      if (error) throw error;

      const secondsUsed = (data as any)?.guest_seconds_used || 0;
      return Math.max(0, dailyLimit - secondsUsed);
    } catch (e) {
      console.error('checkUsage guest error:', e);
      return dailyLimit; // Fallback on error
    }
  }

  // If neither user nor guest, return the full limit
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
