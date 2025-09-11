// In lib/server/conversation-logic.ts

import { randomUUID } from 'crypto';
import { runChat } from '@/lib/llm';

// Creates a new conversation for a user or guest
const mem: Record<string, { id: string; title: string | null; created_at: string; updated_at: string; user_id: string | null; messages: Array<{ role: 'user' | 'assistant'; content: string }> }> = {};

export async function createConversation(userId: string | null) {
  const id = randomUUID();
  const now = new Date().toISOString();
  mem[id] = { id, title: 'New Conversation', created_at: now, updated_at: now, user_id: userId, messages: [] };
  return { id, title: mem[id].title, created_at: now, updated_at: now };
}

// Saves a message and updates the conversation's timestamp
export async function saveMessage(
  convoId: string,
  role: 'user' | 'assistant',
  content: string,
  _userId: string | null,
) {
  const c = mem[convoId];
  if (!c) return;
  c.messages.push({ role, content });
  c.updated_at = new Date().toISOString();
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

  if (cleanedTitle && mem[convoId]) mem[convoId].title = cleanedTitle;
  return cleanedTitle;
}
