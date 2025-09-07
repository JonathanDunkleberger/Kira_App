// In lib/server/conversation-logic.ts

import { getSupabaseServerAdmin } from '@/lib/server/supabaseAdmin';
import { FREE_TRIAL_SECONDS } from '@/lib/server/env.server';
import { runChat } from '@/lib/llm';

const supa = getSupabaseServerAdmin();

// Creates a new conversation for a user or guest
export async function createConversation(userId: string | null) {
  const isGuest = !userId;
  const { data, error } = await supa
    .from('conversations')
    .insert({
      user_id: userId,
      is_guest: isGuest,
      seconds_remaining: isGuest ? FREE_TRIAL_SECONDS : null,
      title: 'New Conversation',
    })
    .select('id, title, created_at, updated_at')
    .single();

  if (error) throw new Error(`Failed to create conversation: ${error.message}`);
  return data as { id: string; title: string | null; created_at: string; updated_at: string };
}

// Saves a message and updates the conversation's timestamp
export async function saveMessage(
  convoId: string,
  role: 'user' | 'assistant',
  content: string,
  userId: string | null,
) {
  const { error: msgError } = await supa
    .from('messages')
    .insert({ conversation_id: convoId, role, content, user_id: userId });
  if (msgError) console.error(`[DB] Failed to insert message for ${convoId}:`, msgError);

  const { error: convoError } = await supa
    .from('conversations')
    .update({ updated_at: new Date().toISOString() })
    .eq('id', convoId);
  if (convoError) console.error(`[DB] Failed to update timestamp for ${convoId}:`, convoError);
}

// Generates and saves an intelligent title
export async function generateAndSaveTitle(
  convoId: string,
  history: Array<{ role: 'user' | 'assistant'; content: string }>,
) {
  if (history.filter((m) => m.role === 'user').length > 2) return null; // Only title early conversations
  const content = history.map((m) => `${m.role}: ${m.content}`).join('\n');
  const systemPrompt = `Summarize the following conversation into a short, catchy title of 5 words or less. Just return the title itself, nothing else.\n\nCONVERSATION:\n${content}`;

  const title = await runChat([
    { role: 'system', content: systemPrompt },
    { role: 'user', content: 'TITLE ONLY' },
  ]);
  const cleanedTitle = (title || '').replace(/["\\]/g, '').trim();

  if (cleanedTitle) {
    await supa.from('conversations').update({ title: cleanedTitle }).eq('id', convoId);
  }
  return cleanedTitle;
}
