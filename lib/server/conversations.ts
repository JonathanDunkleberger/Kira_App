// Supabase-based conversation helpers removed. Placeholder implementations provided.
// TODO: Implement persistent storage with Prisma.

import { randomUUID } from 'crypto';

import { runChat } from '@/lib/llm';

interface MemoryConversationMeta {
  id: string;
  title: string;
  created_at: string;
  updated_at: string;
  user_id: string | null;
  is_guest: boolean;
}

const memoryStore: Record<string, { meta: MemoryConversationMeta; messages: Array<{ role: 'user' | 'assistant'; content: string }> }> = {};

export async function createNewConversation(userId: string | null, title?: string) {
  const id = randomUUID();
  const now = new Date().toISOString();
  memoryStore[id] = {
    meta: {
      id,
      title: title || 'New Conversation',
      created_at: now,
      updated_at: now,
      user_id: userId,
      is_guest: !userId,
    },
    messages: [],
  };
  return memoryStore[id].meta;
}

export async function saveMessage(
  conversationId: string,
  role: 'user' | 'assistant',
  content: string,
  userId: string | null,
) {
  const convo = memoryStore[conversationId];
  if (!convo) return;
  convo.messages.push({ role, content });
  convo.meta.updated_at = new Date().toISOString();
}

export async function generateConversationTitle(
  conversationId: string,
  history: Array<{ role: 'user' | 'assistant'; content: string }>,
): Promise<string> {
  const content = history.map((m) => `${m.role}: ${m.content}`).join('\n');
  try {
    const title = await runChat([
      { role: 'system', content: 'Summarize the following conversation into ≤5 word title.' },
      { role: 'user', content },
    ]);
    const cleaned = (title || '').replace(/["\\]/g, '').trim();
    if (cleaned && memoryStore[conversationId]) memoryStore[conversationId].meta.title = cleaned;
    return cleaned;
  } catch {
    return 'Conversation';
  }
}

export async function claimGuestConversation(userId: string, guestConvId: string) {
  const convo = memoryStore[guestConvId];
  if (!convo) return;
  convo.meta.user_id = userId;
  convo.meta.is_guest = false;
}
