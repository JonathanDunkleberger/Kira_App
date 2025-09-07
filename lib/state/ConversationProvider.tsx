'use client';

import { createContext, useContext, useState, useEffect, useCallback, useRef } from 'react';
import { Session } from '@supabase/supabase-js';

import { supabase } from '@/lib/client/supabaseClient';
import { useConversationManager } from '@/lib/hooks/useConversationManager';
import { useVoiceSocket } from '@/lib/hooks/useVoiceSocket';
import { useConditionalMicrophone } from '@/lib/hooks/useConditionalMicrophone';
import { useEntitlement } from '@/lib/hooks/useEntitlement';
import { AudioPlayer } from '@/lib/audio';

// --- TYPE DEFINITIONS ---
// (Keep your existing type definitions: Message, etc.)
type TurnStatus = 'idle' | 'listening' | 'processing' | 'speaking';

type ConversationStatus = 'idle' | 'active' | 'ended_by_user' | 'ended_by_limit';

export interface ConversationContextType {
  session: Session | null;
  turnStatus: TurnStatus;
  conversationStatus: ConversationStatus;
  isConversationActive: boolean;
  messages: any[]; // Replace with your Message type
  startConversation: () => void;
  stopConversation: () => void;
  // Commonly used app fields (subset for compatibility)
  isPro: boolean;
  dailySecondsRemaining: number; // seconds, 0 if unknown
  dailyLimitSeconds: number; // seconds, 0 if unknown
  usageRemaining: number; // alias of dailySecondsRemaining
  refreshUsage: () => Promise<void> | void;
  paywallSource?: 'proactive_click' | 'time_exhausted' | null;
  promptPaywall: (s: 'proactive_click' | 'time_exhausted') => void;
  closePaywall: () => void;
  // Alias for components expecting an upgrade nudge source
  upgradeNudgeSource?: 'proactive_click' | 'time_exhausted' | null;
  viewMode?: 'conversation' | 'history';
  setViewMode?: (v: 'conversation' | 'history') => void;
  error?: string | null;
  showUpgradeNudge?: boolean;
  setShowUpgradeNudge?: (v: boolean) => void;
  // Achievements toast
  newlyUnlockedToast?: any | null;
  setNewlyUnlockedToast?: (v: any | null) => void;
  externalMicActive?: boolean;
  setExternalMicActive?: (v: boolean) => void;
  connectionStatus?: 'connecting' | 'connected' | 'disconnected';
  submitAudioChunk?: (blob: Blob) => Promise<void>;
  // Conversations list/controls used by Sidebar and others
  allConversations: any[];
  fetchAllConversations: () => Promise<void>;
  loadConversation: (id: string) => Promise<void>;
  newConversation: () => Promise<string | null>;
  clearCurrentConversation: () => void;
  currentConversationId: string | null;
  conversationId: string | null;
}

const ConversationContext = createContext<ConversationContextType | undefined>(undefined);

export default function ConversationProvider({ children }: { children: React.ReactNode }) {
  const [session, setSession] = useState<Session | null>(null);
  const [turnStatus, setTurnStatus] = useState<TurnStatus>('idle');
  const [conversationStatus, setConversationStatus] = useState<ConversationStatus>('idle');
  const [viewMode, setViewMode] = useState<'conversation' | 'history'>('conversation');
  const [error, setError] = useState<string | null>(null);
  const [paywallSource, setPaywallSource] = useState<'proactive_click' | 'time_exhausted' | null>(
    null,
  );
  const [showUpgradeNudge, setShowUpgradeNudge] = useState<boolean>(false);
  const [externalMicActive, setExternalMicActive] = useState<boolean>(false);
  const [newlyUnlockedToast, setNewlyUnlockedToast] = useState<any | null>(null);

  const {
    conversationId,
    messages,
    setMessages,
    newConversation,
    clearCurrentConversation,
    allConversations,
    fetchAllConversations,
    loadConversation,
  } = useConversationManager(session);

  // Entitlement fields used widely across UI
  const {
    userStatus,
    secondsRemaining,
    dailyLimitSeconds,
    refresh: refreshUsage,
  } = useEntitlement() as any;
  const isPro = userStatus === 'pro';
  const dailySecondsRemainingRaw = Number.isFinite(secondsRemaining) ? Number(secondsRemaining) : 0;
  const dailyLimitSecondsRaw = Number.isFinite(dailyLimitSeconds) ? Number(dailyLimitSeconds) : 0;
  const usageRemainingRaw = dailySecondsRemainingRaw;

  // --- AUDIO PLAYER MANAGEMENT ---
  // Create a ref to hold the AudioPlayer instance. This is critical.
  const audioPlayerRef = useRef<AudioPlayer | null>(null);
  const segmentedModeRef = useRef<boolean>(false);

  // This effect ensures we have an AudioPlayer instance when the component mounts.
  useEffect(() => {
    if (!audioPlayerRef.current) {
      audioPlayerRef.current = new AudioPlayer();
      // When audio playback finishes, return to listening within an active session
      audioPlayerRef.current.onEnded(() => {
        setTurnStatus('listening');
      });
    }
  }, []);

  // --- SERVER MESSAGE HANDLING ---
  const handleServerMessage = useCallback(
    (msg: any) => {
    // If the message is audio data, send it to the current segment buffer.
      if (msg instanceof ArrayBuffer) {
        try {
          if (segmentedModeRef.current) {
            // Segmented path: append to active segment only
            (audioPlayerRef.current as any)?.appendChunkToSegment?.(msg);
          } else {
            // Legacy single-blob path
            audioPlayerRef.current?.appendChunk(msg);
          }
        } catch {}
        return;
      }

      // Handle JSON messages from the server
      switch (msg.type) {
        case 'transcript':
          setMessages((prev: any[]) => [
            ...prev,
            { id: Date.now().toString(), role: 'user', content: msg.text },
          ]);
          setTurnStatus('processing');
          break;
        case 'assistant_text':
          setMessages((prev: any[]) => [
            ...prev,
            { id: Date.now().toString(), role: 'assistant', content: msg.text },
          ]);
          break;
        case 'assistant_text_chunk':
          // Segment-aware TTS: begin a segment when first chunk, end on punctuation server-side.
          // We rely on server to flush segments; here we can optionally signal segment boundaries if needed.
          break;
        case 'audio_start':
          setTurnStatus('speaking');
          try {
            segmentedModeRef.current = false; // reset at the start of each turn
            // Initialize a new turn; set server-provided mime if available
            (audioPlayerRef.current as any)?.beginTurn?.(msg?.mime);
            // Also reset legacy buffer to avoid mixing modes
            audioPlayerRef.current?.reset();
          } catch {}
          break;
        case 'segment_start':
          try {
            segmentedModeRef.current = true;
            (audioPlayerRef.current as any)?.beginSegment?.();
          } catch {}
          break;
        case 'segment_end':
          try {
            (audioPlayerRef.current as any)?.endSegment?.();
          } catch {}
          break;
        case 'audio_end':
          try {
            // Close the turn; segments should already be flushed
            (audioPlayerRef.current as any)?.closeTurn?.();
            // Legacy path: finalize single-blob stream (only if segmented not used)
            if (!segmentedModeRef.current) void audioPlayerRef.current?.endStream();
          } catch {}
          break;
        case 'usage_update': {
          // Optimistically set remaining seconds when provided by WS
          const secs = Number((msg as any)?.secondsRemaining);
          if (Number.isFinite(secs)) {
            try {
              // useEntitlement returns setSecondsRemaining via closure captured in refreshUsage
              // but we don't have it here directly; trigger a custom event and rely on hook listener
              window.dispatchEvent(
                new CustomEvent('entitlement:update:secondsRemaining', { detail: secs }),
              );
            } catch {}
          } else {
            try {
              refreshUsage?.();
            } catch {}
          }
          break;
        }
      }
    },
    [setMessages, refreshUsage],
  );

  const {
    status: connectionStatus,
    send,
    disconnect,
  } = useVoiceSocket({
    onMessage: handleServerMessage,
    conversationId,
  });

  const { start: startMicrophone, stop: stopMicrophone } = useConditionalMicrophone((audioBlob) => {
    audioBlob.arrayBuffer().then(send);
  });

  const submitAudioChunk = useCallback(
    async (blob: Blob) => {
      try {
        send(await blob.arrayBuffer());
      } catch (e) {
        console.error('submitAudioChunk failed', e);
      }
    },
    [send],
  );

  // --- CORE CONVERSATION LOGIC ---
  const startConversation = useCallback(async () => {
    // Prevent starting if already active
    if (conversationId || turnStatus !== 'idle') return;

    // 1. Create a new conversation record in the database
    const newId = await newConversation();
    if (!newId) {
      console.error('Failed to create a new conversation.');
      return;
    }

    // 2. Start the microphone
    startMicrophone();

    // 3. Set the initial state for the active conversation
    setTurnStatus('listening');
    setConversationStatus('active');
  }, [conversationId, turnStatus, newConversation, startMicrophone]);

  const stopConversation = useCallback(() => {
    console.log('Stopping conversation, performing hard reset...');
    try {
      disconnect();
    } catch {}
    try {
      stopMicrophone();
    } catch {}
    try {
      audioPlayerRef.current?.reset();
    } catch {}
    clearCurrentConversation();
    setTurnStatus('idle');
    setConversationStatus('ended_by_user');
  }, [disconnect, stopMicrophone, clearCurrentConversation]);

  // --- AUTH ---
  useEffect(() => {
    supabase.auth.getSession().then(({ data }) => setSession(data.session));
    const { data: authListener } = supabase.auth.onAuthStateChange((_event, session) => {
      setSession(session);
      // If user logs out, perform a hard reset
      stopConversation();
    });
    return () => authListener.subscription.unsubscribe();
  }, [stopConversation]);

  const promptPaywall = useCallback(
    (source: 'proactive_click' | 'time_exhausted') => setPaywallSource(source),
    [],
  );
  const closePaywall = useCallback(() => setPaywallSource(null), []);

  // --- CONTEXT VALUE ---
  const value: ConversationContextType = {
    session,
    turnStatus,
    conversationStatus,
    isConversationActive: !!conversationId,
    messages,
    startConversation,
    stopConversation,
    // Entitlement
    isPro,
    dailySecondsRemaining: dailySecondsRemainingRaw,
    dailyLimitSeconds: dailyLimitSecondsRaw,
    usageRemaining: usageRemainingRaw,
    refreshUsage,
    // Paywall
    paywallSource,
    upgradeNudgeSource: paywallSource,
    promptPaywall,
    closePaywall,
    // UI
    viewMode,
    setViewMode,
    error,
    // Nudge
    showUpgradeNudge,
    setShowUpgradeNudge,
    // Achievements
    newlyUnlockedToast,
    setNewlyUnlockedToast,
    // External mic
    externalMicActive,
    setExternalMicActive,
    // WS
    connectionStatus,
    submitAudioChunk,
    // Conversations list
    allConversations: allConversations ?? [],
    fetchAllConversations: fetchAllConversations!,
    loadConversation: loadConversation!,
    newConversation: newConversation!,
    clearCurrentConversation: clearCurrentConversation!,
    currentConversationId: conversationId ?? null,
    conversationId: conversationId ?? null,
  } as any;

  return <ConversationContext.Provider value={value}>{children}</ConversationContext.Provider>;
}

export const useConversation = () => {
  const context = useContext(ConversationContext);
  if (context === undefined) {
    throw new Error('useConversation must be used within a ConversationProvider');
  }
  return context;
};
