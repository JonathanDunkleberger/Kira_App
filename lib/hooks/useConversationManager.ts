"use client";
import { useCallback, useEffect, useState } from 'react';
import type { Session } from '@supabase/supabase-js';
import { listConversations, createConversation as apiCreateConversation, getMessagesForConversation } from '@/lib/client-api';

type Message = { id: string; role: 'user' | 'assistant'; content: string };
type Convo = { id: string; title: string | null; updated_at: string };

export function useConversationManager(session: Session | null) {
  const [conversationId, setConversationId] = useState<string | null>(null);
  const [messages, setMessages] = useState<Message[]>([]);
  const [allConversations, setAllConversations] = useState<Convo[]>([]);

  const fetchAllConversations = useCallback(async () => {
    if (!session) { setAllConversations([]); return; }
    try {
      const convos = await listConversations();
      setAllConversations(convos as any);
    } catch (e) {
      console.error('Failed to fetch conversations', e);
      setAllConversations([]);
    }
  }, [session]);

  useEffect(() => { void fetchAllConversations(); }, [fetchAllConversations]);

  const loadConversation = useCallback(async (id: string) => {
    setConversationId(id);
    setMessages([]);
    try {
      const msgs = await getMessagesForConversation(id);
      const arr = Array.isArray(msgs) ? msgs : (msgs?.messages ?? []);
      setMessages(arr as any);
    } catch (e) {
      console.error('Failed to load messages', e);
    }
  }, []);

  const newConversation = useCallback(async () => {
    try {
      const convo = await apiCreateConversation();
      setAllConversations(prev => [convo as any, ...prev]);
      await loadConversation((convo as any).id);
    } catch (e) {
      console.error('Failed to create conversation', e);
    }
  }, [loadConversation]);

  // Helper variant that returns the created ID for callers that need it immediately
  const newConversationAndGetId = useCallback(async (): Promise<string | null> => {
    try {
      const convo = await apiCreateConversation();
      const id = (convo as any).id as string | undefined;
      if (!id) return null;
      setAllConversations(prev => [convo as any, ...prev]);
      await loadConversation(id);
      return id;
    } catch (e) {
      console.error('Failed to create conversation', e);
      return null;
    }
  }, [loadConversation]);

  return {
    conversationId, setConversationId,
    messages, setMessages,
    allConversations, fetchAllConversations,
  loadConversation, newConversation,
  newConversationAndGetId,
  };
}
