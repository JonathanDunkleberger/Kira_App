'use client';

import { createContext, useContext, useState, useEffect, useCallback, useRef } from 'react';

// Supabase session removed; Session type replaced with minimal placeholder.
type Session = { userId: string } | null;
import { useConversationManager } from '@/lib/hooks/useConversationManager';
// Unified voice transport now sourced from single facade in lib/voice
import { useVoiceSocket } from '@/lib/voice';
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
  } = useConversationManager();

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
      // If the message is audio data, buffer for single-blob playback.
      if (msg instanceof ArrayBuffer) {
        try {
          audioPlayerRef.current?.appendChunk(msg);
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
          // Ignored for single-blob audio playback
          break;
        case 'audio_start':
          setTurnStatus('speaking');
          try {
            segmentedModeRef.current = false;
            // Set content type if provided
            (audioPlayerRef.current as any)?.setContentType?.(msg?.mime);
            audioPlayerRef.current?.reset();
          } catch {}
          break;
        case 'segment_start':
        case 'segment_end':
          // No-op in single-blob mode
          break;
        case 'audio_end':
          try {
            // Finalize single-blob stream
            void audioPlayerRef.current?.endStream();
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

  const voice = useVoiceSocket(handleServerMessage);
  const connectionStatus = voice.status as any;
  const send = useCallback((data: ArrayBuffer) => voice.sendBinary?.(data), [voice]);
  const disconnect = useCallback(() => voice.endCall(), [voice]);

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
  // Auth syncing removed (Clerk handles globally); session kept null.

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
