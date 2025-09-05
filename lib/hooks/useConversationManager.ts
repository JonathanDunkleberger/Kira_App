"use client";
import { useCallback, useState } from 'react';
import type { Session } from '@supabase/supabase-js';
import { supabase } from '@/lib/client/supabaseClient';
import { createConversation as apiCreateConversation, listConversations } from '@/lib/client-api';

type Message = { role: 'user' | 'assistant'; content: string; id: string };
type Convo = { id: string; title: string | null; updated_at: string };

type ViewMode = 'conversation' | 'history';

export function useConversationManager(session: Session | null) {
  const [conversationId, setConversationId] = useState<string | null>(null);
  const [messages, setMessages] = useState<Message[]>([]);
  const [allConversations, setAllConversations] = useState<Convo[]>([]);
  const [viewMode, setViewMode] = useState<ViewMode>('conversation');

  const loadConversation = useCallback(async (id: string) => {
    setConversationId(id);
    setMessages([]);
    setViewMode('conversation');
    try {
      const { data: { session: sess } } = await supabase.auth.getSession();
      if (!sess) return;
      const res = await fetch(`/api/conversations/${id}/messages`, {
        headers: { Authorization: `Bearer ${sess.access_token}` }
      });
      if (!res.ok) return;
      const data = await res.json().catch(() => ({}));
      if (Array.isArray(data?.messages)) {
        setMessages(data.messages.map((m: any) => ({ id: m.id, role: m.role, content: m.content })));
      }
    } catch (e) {
      console.warn('Failed to fetch messages for conversation', id, e);
    }
  }, []);

  const fetchAllConversations = useCallback(async () => {
    if (!session) { setAllConversations([]); return; }
    try {
      const list = await listConversations();
      setAllConversations(list as any);
    } catch (e) {
      console.error('Failed to fetch conversations', e);
      setAllConversations([]);
    }
  }, [session]);

  const newConversation = useCallback(async () => {
    try {
      const convo = await apiCreateConversation();
      await fetchAllConversations();
      loadConversation(convo.id);
    } catch (e) {
      console.error('Failed to create conversation', e);
    }
  }, [fetchAllConversations, loadConversation]);

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
