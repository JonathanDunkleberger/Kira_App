'use client';

import { createContext, useContext, useState, useEffect, useCallback } from 'react';
import { Session } from '@supabase/supabase-js';
import { supabase } from '@/lib/client/supabaseClient';
import { useConversationManager } from '@/lib/hooks/useConversationManager';
import { useVoiceSocket } from '@/lib/hooks/useVoiceSocket';
import { useConditionalMicrophone } from '@/lib/hooks/useConditionalMicrophone';
import { useEntitlement } from '@/lib/hooks/useEntitlement';

// ... (Keep your existing type definitions: ConversationContextType, Message, etc.)

const ConversationContext = createContext<any>(undefined);

export default function ConversationProvider({ children }: { children: React.ReactNode }) {
  const [session, setSession] = useState<Session | null>(null);
  const [turnStatus, setTurnStatus] = useState<'idle' | 'listening' | 'processing' | 'speaking'>('idle');

  const {
    conversationId,
    messages, setMessages,
    allConversations,
    loadConversation,
    newConversation,
  } = useConversationManager(session);

  const { secondsRemaining, refresh: refreshUsage } = useEntitlement();

  const handleServerMessage = useCallback((msg: any) => {
    if (msg instanceof ArrayBuffer) return; // Audio is handled by the audio player

    switch (msg.type) {
      case 'transcript':
        setMessages(prev => [...prev, { id: Date.now().toString(), role: 'user', content: msg.text }]);
        setTurnStatus('processing');
        break;
      case 'assistant_text':
        setMessages(prev => [...prev, { id: Date.now().toString(), role: 'assistant', content: msg.text }]);
        break;
      case 'audio_start':
        setTurnStatus('speaking');
        break;
      case 'audio_end':
        setTurnStatus('listening');
        break;
      case 'usage_update':
        refreshUsage(); // Tell the entitlement hook to refresh its data
        break;
    }
  }, [setMessages, refreshUsage]);

  const { send } = useVoiceSocket({ onMessage: handleServerMessage, conversationId });

  const { start: startMicrophone, stop: stopMicrophone } = useConditionalMicrophone((audioBlob) => {
    // This callback is fired by the microphone's VAD when an utterance is complete
    audioBlob.arrayBuffer().then(send);
  });

  useEffect(() => {
    supabase.auth.getSession().then(({ data }) => setSession(data.session));
    const { data: authListener } = supabase.auth.onAuthStateChange((_event, session) => {
      setSession(session);
      // On login/logout, reset the conversation state
      setMessages([]);
      setTurnStatus('idle');
    });
    return () => authListener.subscription.unsubscribe();
  }, []);

  const stopConversation = useCallback(() => {
    stopMicrophone(); // Manually stop the mic
    setTurnStatus('idle');
  }, [stopMicrophone]);

  const startConversation = useCallback(async () => {
    if (turnStatus !== 'idle') return;

    let activeConvoId = conversationId;
    if (!activeConvoId) {
      const newId = await newConversation();
      if (!newId) {
        console.error("Failed to create a new conversation.");
        return;
      }
      activeConvoId = newId;
    }
    
    // Once we have a conversation ID, we can start the microphone
    startMicrophone();
    setTurnStatus('listening');

  }, [turnStatus, conversationId, newConversation, startMicrophone]);

  // This is the only change. We no longer have the complex useEffect that was
  // causing the race condition. The start/stop logic is now cleanly handled
  // by the startConversation and stopConversation functions.

  const value = {
    session,
    conversationId,
    messages,
    turnStatus,
    allConversations,
    loadConversation,
    newConversation,
    startConversation,
    stopConversation,
    secondsRemaining
  };

  return <ConversationContext.Provider value={value}>{children}</ConversationContext.Provider>;
}

export const useConversation = () => useContext(ConversationContext);
