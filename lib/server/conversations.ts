import { getSupabaseServerAdmin } from '@/lib/server/supabaseAdmin';
import { FREE_TRIAL_SECONDS } from '@/lib/server/env.server';
import { runChat } from '@/lib/llm';

const supa = getSupabaseServerAdmin();

export async function createNewConversation(userId: string | null, title?: string) {
  const isGuest = !userId;
  const { data, error } = await supa
    .from('conversations')
    .insert({
      user_id: userId,
      title: title || 'New Conversation',
      is_guest: isGuest,
      seconds_remaining: isGuest ? FREE_TRIAL_SECONDS : null,
    })
    .select('id, title, created_at, updated_at')
    .single();

  if (error) throw new Error(error.message);
  return data as { id: string; title: string; created_at: string; updated_at: string };
}

export async function saveMessage(
  conversationId: string,
  role: 'user' | 'assistant',
  content: string,
  userId: string | null,
) {
  const { error } = await supa
    .from('messages')
    .insert({ conversation_id: conversationId, role, content, user_id: userId });

  if (error) {
    console.error('[DB] Failed to insert message', { conversationId, error });
    return;
  }

  await supa
    .from('conversations')
    .update({ updated_at: new Date().toISOString() })
    .eq('id', conversationId);
}

export async function generateConversationTitle(
  conversationId: string,
  history: Array<{ role: 'user' | 'assistant'; content: string }>,
): Promise<string> {
  const content = history.map((m) => `${m.role}: ${m.content}`).join('\n');
  const systemPrompt =
    'Summarize the following conversation into a short, catchy title of 5 words or less. Just return the title, nothing else.';

  const title = await runChat([
    { role: 'system', content: systemPrompt },
    { role: 'user', content },
  ]);
  const cleanedTitle = (title || '').replace(/["\\]/g, '').trim();
  if (cleanedTitle) {
    await supa.from('conversations').update({ title: cleanedTitle }).eq('id', conversationId);
  }
  return cleanedTitle;
}

export async function claimGuestConversation(userId: string, guestConvId: string) {
  // Re-assign conversation ownership
  await supa
    .from('conversations')
    .update({ user_id: userId, is_guest: false })
    .eq('id', guestConvId);

  // Transfer remaining free-trial seconds from guest to the new user's entitlement (best-effort)
  try {
    const { data: guestConv } = await supa
      .from('conversations')
      .select('seconds_remaining')
      .eq('id', guestConvId)
      .single();

    if (guestConv && typeof (guestConv as any).seconds_remaining === 'number') {
      await supa
        .from('entitlements')
        .update({ trial_seconds_remaining: (guestConv as any).seconds_remaining })
        .eq('user_id', userId);
    }
  } catch (e) {
    console.warn('Failed to transfer guest remaining seconds:', e);
  }
}
