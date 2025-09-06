'use client';

import { createContext, useContext, useState, useEffect, useCallback } from 'react';
import { Session } from '@supabase/supabase-js';
import { supabase } from '@/lib/client/supabaseClient';
import { useConversationManager } from '@/lib/hooks/useConversationManager';
import { useVoiceSocket } from '@/lib/hooks/useVoiceSocket';
import { useConditionalMicrophone } from '@/lib/hooks/useConditionalMicrophone';
import { useEntitlement } from '@/lib/hooks/useEntitlement';
import { checkAchievements } from '@/lib/achievements';

type Message = { id: string; role: 'user' | 'assistant'; content: string };

type ConversationContextType = {
  session: Session | null;
  conversationId: string | null;
  messages: Message[];
  turnStatus: 'idle' | 'listening' | 'processing' | 'speaking';
  conversationStatus: 'idle' | 'active' | 'ended_by_user' | 'ended_by_limit';
  allConversations: Array<{ id: string; title: string | null; updated_at: string }>;
  fetchAllConversations: () => Promise<void>;
  loadConversation: (id: string) => Promise<void>;
  newConversation: () => Promise<void>;
  startConversation: () => Promise<void>;
  stopConversation: (reason?: 'ended_by_user' | 'ended_by_limit') => void;
  // Entitlement
  isPro: boolean;
  dailySecondsRemaining: number | null;
  dailyLimitSeconds: number;
  // Paywall
  paywallSource: 'proactive_click' | 'time_exhausted' | null;
  promptPaywall: (source: 'proactive_click' | 'time_exhausted') => void;
  closePaywall: () => void;
  // UI/UX
  viewMode: 'conversation' | 'history';
  setViewMode: (mode: 'conversation' | 'history') => void;
  error: string | null;
  // Upgrade nudge snackbar (optional usage by portal)
  showUpgradeNudge?: boolean;
  setShowUpgradeNudge?: (open: boolean) => void;
  upgradeNudgeSource?: 'last_turn' | 'proactive_threshold';
  // Animations/meters
  micVolume: number;
  kiraVolume: number;
  // External mic integration
  submitAudioChunk: (blob: Blob) => Promise<void>;
  externalMicActive: boolean;
  setExternalMicActive: (v: boolean) => void;
  // Legacy aliases/controls used by some components
  currentConversationId?: string | null;
  clearCurrentConversation: () => void;
  // Achievements/toasts
  unlockedAchievements?: string[];
  newlyUnlockedToast?: { id: string; name: string; description?: string | null } | null;
  setNewlyUnlockedToast?: (val: { id: string; name: string; description?: string | null } | null) => void;
};

const ConversationContext = createContext<ConversationContextType | undefined>(undefined);

export default function ConversationProvider({ children }: { children: React.ReactNode }) {
  const [session, setSession] = useState<Session | null>(null);
  const [turnStatus, setTurnStatus] = useState<'idle' | 'listening' | 'processing' | 'speaking'>('idle');
  const [conversationStatus, setConversationStatus] = useState<'idle' | 'active' | 'ended_by_user' | 'ended_by_limit'>('idle');
  const [viewMode, setViewMode] = useState<'conversation' | 'history'>('conversation');
  const [error, setError] = useState<string | null>(null);
  const [micVolume, setMicVolume] = useState(0);
  const [kiraVolume, setKiraVolume] = useState(0);
  const [paywallSource, setPaywallSource] = useState<'proactive_click' | 'time_exhausted' | null>(null);
  const [externalMicActive, setExternalMicActive] = useState(false);
  const [newlyUnlockedToast, setNewlyUnlockedToast] = useState<{ id: string; name: string; description?: string | null } | null>(null);
  const [unlockedAchievements, setUnlockedAchievements] = useState<string[]>([]);
  const [showUpgradeNudge, setShowUpgradeNudge] = useState<boolean>(false);
  const [upgradeNudgeSource, setUpgradeNudgeSource] = useState<'last_turn' | 'proactive_threshold' | undefined>(undefined);

  const {
    conversationId,
    messages, setMessages,
    allConversations, fetchAllConversations,
    loadConversation, newConversation,
    newConversationAndGetId,
  } = useConversationManager(session);

  // Entitlement
  const { userStatus, secondsRemaining, dailyLimitSeconds, setSecondsRemaining } = useEntitlement() as any;
  const isPro = userStatus === 'pro';
  const dailySecondsRemaining = Number.isFinite(secondsRemaining) ? Number(secondsRemaining) : null;

  const handleServerMessage = useCallback((msg: any) => {
    if (msg instanceof ArrayBuffer) {
      // Audio chunk streaming hook point
      return;
    }
    switch (msg?.type) {
      case 'transcript':
        setMessages(prev => [...prev, { id: `user-${Date.now()}`, role: 'user', content: String(msg.text || '') }]);
        setTurnStatus('processing');
        break;
      case 'assistant_text':
        setMessages(prev => [...prev, { id: `assistant-${Date.now()}`, role: 'assistant', content: String(msg.text || '') }]);
        break;
      case 'title_update':
        void fetchAllConversations();
        break;
      case 'audio_start':
        setTurnStatus('speaking');
        break;
      case 'audio_end':
        setTurnStatus('listening');
        break;
      case 'usage_update':
        if (typeof msg.secondsRemaining === 'number') {
          setSecondsRemaining?.(msg.secondsRemaining);
        }
        break;
    }
  }, [fetchAllConversations, setMessages]);

  const { status: wsStatus, send: wsSend } = useVoiceSocket({ onMessage: handleServerMessage, conversationId });

  const { start: startMicrophone, stop: stopMicrophone } = useConditionalMicrophone((audioBlob) => {
    audioBlob.arrayBuffer().then(buffer => wsSend(buffer));
  });

  useEffect(() => {
    supabase.auth.getSession().then(({ data: { session } }) => setSession(session));
    const { data: authListener } = supabase.auth.onAuthStateChange((_event, session) => {
      setSession(session);
    });
    return () => authListener.subscription.unsubscribe();
  }, []);

  const startConversation = useCallback(async () => {
    // Ensure we have a conversation in hybrid mode
    let cid = conversationId;
    if (!cid) {
      cid = await newConversationAndGetId();
    }
    // Mark active; a separate effect will flip to 'listening' once WS connects
    if (cid) {
      setConversationStatus('active');
      setTurnStatus('idle');
    }
  }, [conversationId, newConversationAndGetId]);

  const stopConversation = useCallback((reason?: 'ended_by_user' | 'ended_by_limit') => {
    setTurnStatus('idle');
    setConversationStatus(reason || 'ended_by_user');
    try { stopMicrophone({ skipFinalFlush: true } as any); } catch {}
  }, [stopMicrophone]);

  useEffect(() => {
    if (turnStatus === 'listening') {
      if (!externalMicActive) {
        startMicrophone();
      }
    } else {
      stopMicrophone({ skipFinalFlush: true } as any);
    }
  }, [turnStatus, startMicrophone, stopMicrophone, externalMicActive]);

  // Auto-enter listening once WS is connected and we are active
  useEffect(() => {
    if (conversationStatus === 'active' && conversationId && wsStatus === 'connected' && turnStatus === 'idle') {
      setTurnStatus('listening');
    }
  }, [conversationStatus, conversationId, wsStatus, turnStatus]);

  // Evaluate achievements on message/conversation changes
  useEffect(() => {
    try {
      const newly = checkAchievements({
        messagesCount: messages.length,
        conversationCount: allConversations.length,
        memoryCount: 0,
        unlockedAchievements,
      });
      if (Array.isArray(newly) && newly.length) {
        const id = newly[0];
        setUnlockedAchievements(prev => Array.from(new Set([...prev, ...newly])));
        // naive mapping for toast name; real app would map id->meta
        setNewlyUnlockedToast({ id, name: id.replaceAll('_', ' '), description: null });
      }
    } catch {}
  }, [messages.length, allConversations.length]);

  const promptPaywall = useCallback((source: 'proactive_click' | 'time_exhausted') => setPaywallSource(source), []);
  const closePaywall = useCallback(() => setPaywallSource(null), []);

  const submitAudioChunk = useCallback(async (blob: Blob) => {
    try {
      const buf = await blob.arrayBuffer();
      wsSend(buf);
    } catch (e) {
      console.error('submitAudioChunk failed', e);
    }
  }, [wsSend]);

  const clearCurrentConversation = useCallback(() => {
    // Soft clear on client; server keeps history
    setMessages([]);
  }, [setMessages]);

  const value: ConversationContextType = {
    session,
    conversationId,
    messages,
  turnStatus,
  conversationStatus,
    allConversations,
    fetchAllConversations,
    loadConversation,
    newConversation,
    startConversation,
  stopConversation,
  isPro,
  dailySecondsRemaining,
  dailyLimitSeconds,
  paywallSource,
  promptPaywall,
  closePaywall,
  viewMode,
  setViewMode,
  error,
  micVolume,
  kiraVolume,
  submitAudioChunk,
  externalMicActive,
  setExternalMicActive,
  currentConversationId: conversationId,
  clearCurrentConversation,
  unlockedAchievements,
  newlyUnlockedToast,
  setNewlyUnlockedToast,
  showUpgradeNudge,
  setShowUpgradeNudge,
  upgradeNudgeSource,
  };

  return <ConversationContext.Provider value={value}>{children}</ConversationContext.Provider>;
}

export function useConversation() {
  const context = useContext(ConversationContext);
  if (!context) throw new Error('useConversation must be used within a ConversationProvider');
  return context;
}

// Achievement evaluation when counts change
// Keep at bottom to avoid capturing stale closures
// This hook relies on the provider component's scope variables
