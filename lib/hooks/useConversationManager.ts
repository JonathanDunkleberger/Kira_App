// In lib/hooks/useConversationManager.ts

'use client';
import { useCallback, useState, useEffect } from 'react';
import { Session } from '@supabase/supabase-js';
import {
  listConversations as apiListConversations,
  createConversation as apiCreateConversation,
  getMessagesForConversation,
} from '@/lib/client-api';

// Keep existing type definitions
type Message = { id: string; role: 'user' | 'assistant'; content: string };
type Convo = { id: string; title: string | null; updated_at: string };

export function useConversationManager(session: Session | null) {
  const [conversationId, setConversationId] = useState<string | null>(null);
  const [messages, setMessages] = useState<Message[]>([]);
  const [allConversations, setAllConversations] = useState<Convo[]>([]);

  const fetchAllConversations = useCallback(async () => {
    if (!session) {
      setAllConversations([]);
      return;
    }
    try {
      const convos = await apiListConversations();
      setAllConversations(convos);
    } catch (err) {
      console.error('Failed to fetch conversations:', err);
    }
  }, [session]);

  useEffect(() => {
    fetchAllConversations();
  }, [fetchAllConversations]);

  const loadConversation = useCallback(async (id: string) => {
    setConversationId(id);
    setMessages([]); // Clear immediately for snappy UI
    try {
      const msgs = await getMessagesForConversation(id);
      // Ensure we handle both possible response shapes
      const arr = Array.isArray(msgs) ? msgs : (msgs?.messages ?? []);
      setMessages(arr as any);
    } catch (e) {
      console.error('Failed to load messages', e);
    }
  }, []);

  // --- THIS IS THE CRITICAL FIX ---
  // This function now creates a new conversation and simply activates it
  // on the frontend without trying to fetch its (non-existent) messages.
  const newConversation = useCallback(async () => {
    try {
      const newConvo = await apiCreateConversation();
      setAllConversations((prev) => [newConvo as any, ...prev]);
      setConversationId(newConvo.id); // Set the new ID
      setMessages([]); // Set messages to an empty array
      return newConvo.id; // Return the new ID
    } catch (e) {
      console.error('Failed to create conversation', e);
      return null;
    }
  }, []);

  const clearCurrentConversation = useCallback(() => {
    setConversationId(null);
    setMessages([]);
  }, []);

  // Update startConversation in the Provider to use this new version
  const startConversation = useCallback(async () => {
    let currentConvoId = conversationId;
    if (!currentConvoId) {
      const newId = await newConversation();
      if (!newId) return; // Exit if creation failed
      currentConvoId = newId;
    }
    // Now we can safely set the turn status to listening
    // This logic will be in the provider.
  }, [conversationId, newConversation]);

  return {
    conversationId,
    messages,
    setMessages,
    allConversations,
    fetchAllConversations,
    loadConversation,
    newConversation,
    clearCurrentConversation,
  };
}
