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
  const [conversationStatus, setConversationStatus] = useState<'idle' | 'active' | 'ended_by_user' | 'ended_by_limit'>('idle');
  const [viewMode, setViewMode] = useState<'conversation' | 'history'>('conversation');
  const [error, setError] = useState<string | null>(null);
  const [paywallSource, setPaywallSource] = useState<'proactive_click' | 'time_exhausted' | null>(null);
  const [showUpgradeNudge, setShowUpgradeNudge] = useState<boolean>(false);
  const [externalMicActive, setExternalMicActive] = useState<boolean>(false);

  const {
    conversationId,
    messages, setMessages,
    allConversations,
    fetchAllConversations,
    loadConversation,
    newConversation,
    clearCurrentConversation,
  } = useConversationManager(session);

  const { userStatus, secondsRemaining, dailyLimitSeconds, refresh: refreshUsage } = useEntitlement() as any;
  const isPro = userStatus === 'pro';
  const dailySecondsRemaining = Number.isFinite(secondsRemaining) ? Number(secondsRemaining) : null;
  const usageRemaining = dailySecondsRemaining;

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

  const { status: connectionStatus, send, disconnect } = useVoiceSocket({ onMessage: handleServerMessage, conversationId });

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

  const stopConversation = useCallback((reason?: 'ended_by_user' | 'ended_by_limit') => {
    console.log('Stopping conversation, performing hard reset...');
    try { disconnect(); } catch {}
    try { stopMicrophone(); } catch {}
    setTurnStatus('idle');
    setConversationStatus(reason || 'ended_by_user');
    // MOST IMPORTANT: clear active conversation and messages
    clearCurrentConversation();
  }, [disconnect, stopMicrophone, clearCurrentConversation]);

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
  setConversationStatus('active');

  }, [turnStatus, conversationId, newConversation, startMicrophone]);

  // This is the only change. We no longer have the complex useEffect that was
  // causing the race condition. The start/stop logic is now cleanly handled
  // by the startConversation and stopConversation functions.

  const submitAudioChunk = useCallback(async (blob: Blob) => {
    try { send(await blob.arrayBuffer()); } catch (e) { console.error('submitAudioChunk failed', e); }
  }, [send]);

  const promptPaywall = useCallback((source: 'proactive_click' | 'time_exhausted') => setPaywallSource(source), []);
  const closePaywall = useCallback(() => setPaywallSource(null), []);

  const value = {
    // Auth/session
    session,
    // Conversation state
    conversationId,
    currentConversationId: conversationId,
    messages,
    turnStatus,
    conversationStatus,
    // New: boolean flag for active session based on conversationId
    isConversationActive: !!conversationId,
    // WS
    connectionStatus,
    submitAudioChunk,
    // Conversations list
    allConversations,
    fetchAllConversations,
    loadConversation,
    newConversation,
    clearCurrentConversation,
    // Controls
    startConversation,
    stopConversation,
    // Entitlement
    isPro,
    dailySecondsRemaining,
    dailyLimitSeconds,
    usageRemaining,
    refreshUsage,
    // Paywall
    paywallSource,
    promptPaywall,
    closePaywall,
    // UI
    viewMode,
    setViewMode,
    error,
    // Upgrade nudge
    showUpgradeNudge,
    setShowUpgradeNudge,
    // External mic
    externalMicActive,
    setExternalMicActive,
  };

  return <ConversationContext.Provider value={value}>{children}</ConversationContext.Provider>;
}

export const useConversation = () => useContext(ConversationContext);
