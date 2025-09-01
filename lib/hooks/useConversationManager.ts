"use client";
import { useCallback, useState } from 'react';
import type { Session } from '@supabase/supabase-js';
import { createConversation as apiCreateConversation, listConversations, getConversation } from '@/lib/client-api';

type Message = { role: 'user' | 'assistant'; content: string; id: string };
type Convo = { id: string; title: string | null; updated_at: string };

type ViewMode = 'conversation' | 'history';

export function useConversationManager(session: Session | null) {
  const [conversationId, setConversationId] = useState<string | null>(null);
  const [messages, setMessages] = useState<Message[]>([]);
  const [allConversations, setAllConversations] = useState<Convo[]>([]);
  const [viewMode, setViewMode] = useState<ViewMode>('conversation');

  const loadConversation = useCallback(async (id: string) => {
    if (!session) return;
    const data = await getConversation(id);
    const msgs = (data?.messages || []) as Array<{ id: string; role: 'user'|'assistant'; content: string }>;
    setConversationId(id);
    setMessages(msgs.map(m => ({ id: m.id, role: m.role, content: m.content })));
    setViewMode('conversation');
  }, [session]);

  const newConversation = useCallback(async () => {
    if (!session) return;
    const c = await apiCreateConversation('New Conversation');
    setConversationId(c.id);
    setMessages([]);
    listConversations().then(setAllConversations).catch(() => {});
  }, [session]);

  const fetchAllConversations = useCallback(async () => {
    if (!session) { setAllConversations([]); return; }
    try { const list = await listConversations(); setAllConversations(list); } catch {}
  }, [session]);

  return {
    conversationId, setConversationId,
    messages, setMessages,
    allConversations, setAllConversations,
    viewMode, setViewMode,
    loadConversation,
    newConversation,
    fetchAllConversations,
  };
}
