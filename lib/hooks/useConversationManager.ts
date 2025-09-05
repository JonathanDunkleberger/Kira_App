"use client";
import { useCallback, useState } from 'react';
import type { Session } from '@supabase/supabase-js';
import { supabase } from '@/lib/client/supabaseClient';

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
    // Fetch messages directly from Supabase for the selected conversation
    const { data: msgs } = await supabase
      .from('messages')
      .select('id, role, content, created_at')
      .eq('conversation_id', id)
      .order('created_at', { ascending: true });
    setConversationId(id);
    setMessages((msgs || []).map((m: any) => ({ id: m.id, role: m.role, content: m.content })));
    setViewMode('conversation');
  }, [session]);

  const newConversation = useCallback(async () => {
    // No HTTP create; WS server will auto-create on first turn.
    setConversationId(null);
    setMessages([]);
  }, []);

  const fetchAllConversations = useCallback(async () => {
    if (!session) { setAllConversations([]); return; }
    try {
      const { data } = await supabase
        .from('conversations')
        .select('id, title, updated_at')
        .eq('user_id', session.user.id)
        .order('updated_at', { ascending: false });
      setAllConversations((data as any) || []);
    } catch {}
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
