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
    // Keep simple: set the active conversation and clear messages;
    // WebSocket flow will populate messages on demand.
    setConversationId(id);
    setMessages([]);
    setViewMode('conversation');
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
