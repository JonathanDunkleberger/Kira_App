"use client";
import { useState } from 'react';
import type { Session } from '@supabase/supabase-js';

type Message = { role: 'user' | 'assistant'; content: string; id: string };
type Convo = { id: string; title: string | null; updated_at: string };

type ViewMode = 'conversation' | 'history';

// Final refactor: state-only manager; server interactions happen in the provider via WebSocket/HTTP.
export function useConversationManager(_session: Session | null) {
  const [conversationId, setConversationId] = useState<string | null>(null);
  const [messages, setMessages] = useState<Message[]>([]);
  const [allConversations, setAllConversations] = useState<Convo[]>([]);
  const [viewMode, setViewMode] = useState<ViewMode>('conversation');

  return {
    conversationId, setConversationId,
    messages, setMessages,
    allConversations, setAllConversations,
    viewMode, setViewMode,
  };
}
