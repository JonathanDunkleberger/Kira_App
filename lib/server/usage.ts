// In lib/server/usage.ts
import { getSupabaseServerAdmin } from './supabaseAdmin.js';

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
