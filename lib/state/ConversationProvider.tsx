'use client';

import { createContext, useContext, useState, useEffect, useRef, useCallback } from 'react';
import { supabase } from '@/lib/client/supabaseClient';
import { playMp3Base64, playAndAnalyzeAudio, playAudioData, AudioPlayer, preferredTtsFormat } from '@/lib/audio';
import { Session } from '@supabase/supabase-js';
// conversations list is fetched via Supabase in useConversationManager
import { useConversationManager } from '@/lib/hooks/useConversationManager';
import { checkAchievements } from '@/lib/achievements';
import { useEntitlement } from '@/lib/hooks/useEntitlement';
import { useVoiceSocket } from '@/lib/hooks/useVoiceSocket';
import { useConditionalMicrophone } from '@/lib/hooks/useConditionalMicrophone';
import { listConversations } from '@/lib/client-api';

// Increase minimum size to avoid short/noise causing 400 errors
const MIN_AUDIO_BLOB_SIZE = 4000;

// Singleton AudioPlayer instance for the entire session
let audioPlayer: AudioPlayer | null = null;

type TurnStatus = 'idle' | 'listening' | 'processing' | 'speaking';
type ConversationStatus = 'idle' | 'active' | 'ended_by_user' | 'ended_by_limit';
type Message = { role: 'user' | 'assistant'; content: string; id: string };
type Convo = { id: string; title: string | null; updated_at: string };
type ViewMode = 'conversation' | 'history';
type PaywallSource = 'proactive_click' | 'time_exhausted';

interface ConversationContextType {
  session?: Session | null;
  conversationId: string | null;
  currentConversationId?: string | null;
  messages: Message[];
  clearCurrentConversation: () => void;
  conversationStatus: ConversationStatus;
  turnStatus: TurnStatus;
  startConversation: () => void;
  stopConversation: (reason?: ConversationStatus) => void;
  secondsRemaining: number; // pro per-session timer
  isPro: boolean;
  micVolume: number;
  kiraVolume: number;
  error: string | null;
  allConversations: Convo[];
  loadConversation: (id: string) => Promise<void>;
  newConversation: () => Promise<void>;
  fetchAllConversations: () => Promise<void>;
  dailySecondsRemaining: number | null;
  dailyLimitSeconds: number;
  viewMode: ViewMode;
  setViewMode: (mode: ViewMode) => void;
  paywallSource: PaywallSource | null;
  promptPaywall: (source: PaywallSource) => void;
  closePaywall: () => void;
  // proactive upgrade nudge
  showUpgradeNudge?: boolean;
  setShowUpgradeNudge?: (open: boolean) => void;
  upgradeNudgeSource?: 'last_turn' | 'proactive_threshold';
  unlockedAchievements?: string[];
  newlyUnlockedToast?: { id: string; name: string; description?: string | null } | null;
  setNewlyUnlockedToast?: (val: { id: string; name: string; description?: string | null } | null) => void;
  // External mic integrations submit audio here (webm/ogg/mp3 blob)
  submitAudioChunk: (audio: Blob) => Promise<void>;
  // When true, internal VAD/mic capture should be disabled in favor of external source
  externalMicActive: boolean;
  setExternalMicActive: (active: boolean) => void;
}

const ConversationContext = createContext<ConversationContextType | undefined>(undefined);

export default function ConversationProvider({ children }: { children: React.ReactNode }) {
  const [session, setSession] = useState<Session | null>(null);
  const [isPro, setIsPro] = useState(false);
  const conversationStatusRef = useRef<ConversationStatus>('idle');
  // WebSocket audio streaming (Phase 3/4) - initialize singleton player once
  useEffect(() => {
    if (!audioPlayer) {
      audioPlayer = new AudioPlayer();
    }
    audioPlayer.onEnded(() => {
      // Only return to listening if the conversation is still active.
      if (conversationStatusRef.current === 'active') {
        console.log('Audio playback finished, resetting to listening.');
        setTurnStatus('listening');
      }
    });
  }, []);
  const {
    conversationId, setConversationId,
    messages, setMessages,
    allConversations, setAllConversations,
    viewMode, setViewMode,
  } = useConversationManager(session);
  const turnOpenRef = useRef(false);
  const firstAssistantForTurnRef = useRef(true);
  const lastAssistantIdRef = useRef<string | null>(null);
  const userDraftIdRef = useRef<string | null>(null);
  const { status: wsStatus, send: wsSend, disconnect: wsDisconnect } = useVoiceSocket((msg: any) => {
    // Binary audio chunk
    if (msg instanceof ArrayBuffer) {
      try {
        audioPlayer?.appendChunk(msg);
        setTurnStatus(prev => (prev !== 'speaking' ? 'speaking' : prev));
      } catch {}
      return;
    }
    // JSON messages
    try {
      switch (msg?.type) {
        case 'audio_start': {
          firstAssistantForTurnRef.current = true;
          lastAssistantIdRef.current = null;
          turnOpenRef.current = true;
          setTurnStatus('speaking');
          break;
        }
        case 'audio_end': {
          try { audioPlayer?.endStream(); } catch {}
          turnOpenRef.current = false;
          setTimeout(() => setTurnStatus('listening'), 150);
          break;
        }
        case 'transcript': {
          const text = String(msg?.text || '');
          if (!text) break;
          if (!userDraftIdRef.current) {
            const id = `user-${Date.now()}`;
            userDraftIdRef.current = id;
            setMessages(prev => [...prev, { id, role: 'user', content: text }]);
          } else {
            const id = userDraftIdRef.current;
            setMessages(prev => {
              const idx = prev.findIndex(m => m.id === id);
              if (idx === -1) return [...prev, { id, role: 'user', content: text }];
              const next = prev.slice();
              next[idx] = { ...next[idx], content: text };
              return next;
            });
          }
          break;
        }
        case 'assistant_text': {
          const text = String(msg?.text || '');
          if (!text) break;
          if (!turnOpenRef.current) {
            firstAssistantForTurnRef.current = true;
            turnOpenRef.current = true;
          }
          if (firstAssistantForTurnRef.current || !lastAssistantIdRef.current) {
            const id = `assistant-${Date.now()}`;
            lastAssistantIdRef.current = id;
            firstAssistantForTurnRef.current = false;
            setMessages(prev => [...prev, { id, role: 'assistant', content: text }]);
          } else {
            const targetId = lastAssistantIdRef.current;
            setMessages(prev => {
              const idx = prev.findIndex(m => m.id === targetId);
              if (idx === -1) return [...prev, { id: targetId!, role: 'assistant', content: text }];
              const next = prev.slice();
              next[idx] = { ...next[idx], content: text };
              return next;
            });
          }
          break;
        }
        case 'conversation_created': {
          const conv = msg?.conversation;
          if (conv?.id) {
            setConversationId(conv.id);
            // Optimistically add to list
            setAllConversations(prev => [{ id: conv.id, title: conv.title ?? null, updated_at: new Date().toISOString() }, ...prev]);
          }
          break;
        }
        case 'title_update': {
          const { conversationId: cid, title } = msg || {};
          if (cid && title) {
            setAllConversations(prev => prev.map(c => c.id === cid ? { ...c, title } : c));
          }
          break;
        }
        case 'error': {
          setError(String(msg?.message || 'Server error'));
          break;
        }
        default:
          break;
      }
    } catch {}
  });
  const [conversationStatus, setConversationStatus] = useState<ConversationStatus>('idle');
  // Keep a live ref of conversation status to avoid stale values in callbacks
  useEffect(() => { conversationStatusRef.current = conversationStatus; }, [conversationStatus]);
  const [turnStatus, setTurnStatus] = useState<TurnStatus>('idle');
  const [micVolume, setMicVolume] = useState(0);
  const [kiraVolume, setKiraVolume] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const [dailySecondsRemaining, setDailySecondsRemaining] = useState<number | null>(null);
  const [unlockedAchievements, setUnlockedAchievements] = useState<string[]>([]);
  const [newlyUnlockedToast, setNewlyUnlockedToast] = useState<{ id: string; name: string; description?: string | null } | null>(null);
  const [paywallSource, setPaywallSource] = useState<PaywallSource | null>(null);
  const promptPaywall = useCallback((source: PaywallSource) => setPaywallSource(source), []);
  const closePaywall = useCallback(() => setPaywallSource(null), []);
  // proactive nudge state
  const [showUpgradeNudge, setShowUpgradeNudge] = useState(false);
  const [hasShownProactiveNudge, setHasShownProactiveNudge] = useState(false);
  const [upgradeNudgeSource, setUpgradeNudgeSource] = useState<'last_turn' | 'proactive_threshold'>('last_turn');
  const conversationsChannelRef = useRef<any>(null);
  const [proConversationTimer, setProConversationTimer] = useState(1800);
  const [proSessionSeconds, setProSessionSeconds] = useState(1800);
  const proTimerIntervalRef = useRef<NodeJS.Timeout | null>(null);
  const ent = useEntitlement();
  // Removed legacy MediaRecorder/VAD refs in favor of useConditionalMicrophone
  const audioPlayerRef = useRef<HTMLAudioElement | null>(null);
  const isProcessingRef = useRef(false);
  const inflightAbortRef = useRef<AbortController | null>(null);
  const [externalMicActive, setExternalMicActive] = useState(false);

  // Local conversations fetcher (HTTP) used until WS fully replaces it
  const fetchAllConversations = useCallback(async () => {
    try {
      const list = await listConversations();
      setAllConversations(list as any);
    } catch (e) {
      console.error('Failed to fetch conversations', e);
      setAllConversations([]);
    }
  }, [setAllConversations]);

  // New microphone hook: emits complete utterance blobs
  const { start: startMicrophone, stop: stopMicrophone } = useConditionalMicrophone((audioBlob: Blob) => {
    // Mark that we're processing the captured utterance
    setTurnStatus('processing');
  submitAudioChunk(audioBlob);
    // Reset user transcript draft for the next turn
    userDraftIdRef.current = null;
  });

  // Removed lastEvent-based placeholder logic in favor of optimistic callbacks above

  // Sync entitlement -> provider state (but do NOT set dailySecondsRemaining here)
  useEffect(() => {
    if (!ent.isLoading) {
      const pro = ent.userStatus === 'pro';
      setIsPro(pro);
      setProSessionSeconds(ent.proSessionLimit || 1800);
      if (pro && conversationStatus === 'active') {
        setProConversationTimer(ent.proSessionLimit || 1800);
      }
    }
  }, [ent.isLoading, ent.userStatus, ent.proSessionLimit, conversationStatus]);

  // Hydrate dailySecondsRemaining once from the server (authoritative)
  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        // Try to send a guestId if we have one
        const guestId = (typeof window !== 'undefined' && (localStorage.getItem('kiraGuestId') || null)) || null;

        const res = await fetch('/api/usage', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ guestId }),
          credentials: 'include',
        });

        if (res.ok) {
          const data = await res.json().catch(() => null);
          if (!cancelled && typeof data?.secondsRemaining === 'number') {
            setDailySecondsRemaining(data.secondsRemaining);
          }
        }
      } catch {}
    })();
    return () => { cancelled = true; };
  }, []);

  useEffect(() => {
    const getProfile = async (currentSession: Session | null) => {
      setSession(currentSession);
    if (currentSession) {
        // Attempt to claim a guest conversation if present in URL or session
        try {
          const urlParams = new URLSearchParams(window.location.search);
          const urlGuestConv = urlParams.get('guestConvId');
          const storedGuestConv = typeof window !== 'undefined' ? (localStorage.getItem('kiraGuestId') || localStorage.getItem('guestConversationId') || localStorage.getItem('kira_guest_id')) : null;
          const guestConvId = urlGuestConv || storedGuestConv;
          if (guestConvId) {
            await fetch('/api/auth/claim-conversation', {
              method: 'POST',
              headers: {
                'Content-Type': 'application/json',
                'Authorization': `Bearer ${currentSession.access_token}`,
              },
              body: JSON.stringify({ guestConvId })
            });
            // Preserve original guest identity after claim; do NOT remove kiraGuestId
            if (urlGuestConv) {
              urlParams.delete('guestConvId');
              const qs = urlParams.toString();
              window.history.replaceState({}, '', `${window.location.pathname}${qs ? `?${qs}` : ''}`);
            }
          }
        } catch (e) {
          console.warn('Guest conversation claim failed:', e);
        }
        // Logged-in: entitlement will be handled by useEntitlement hook; just ensure timer baseline
        if (isPro) {
          setProConversationTimer(proSessionSeconds);
        }
  // Preload user's conversations
  try { await fetchAllConversations(); } catch { setAllConversations([]); }
        // Realtime updates
        if (conversationsChannelRef.current) {
          try { supabase.removeChannel(conversationsChannelRef.current); } catch {}
        }
        conversationsChannelRef.current = supabase
          .channel('conversations-provider')
          .on('postgres_changes', { event: '*', schema: 'public', table: 'conversations' }, () => {
            fetchAllConversations().catch(() => {});
          })
          .subscribe();

        // Realtime subscription for newly unlocked achievements
        try {
          const uid = currentSession.user.id;
          supabase
            .channel('achievements-realtime')
            .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'user_achievements', filter: `user_id=eq.${uid}` }, async (payload) => {
              try {
                const achId = (payload?.new as any)?.achievement_id as string;
                if (!achId) return;
                const { data } = await supabase.from('achievements').select('id,name,description').eq('id', achId).maybeSingle();
                if (data) {
                  setNewlyUnlockedToast({ id: data.id, name: data.name, description: data.description });
                  setUnlockedAchievements(prev => prev.includes(data.id) ? prev : [...prev, data.id]);
                }
              } catch {}
            })
            .subscribe();
        } catch {}
      } else {
        // Guest: entitlement handled by hook; no-op here
      }
    };

  supabase.auth.getSession().then(({ data: { session } }) => getProfile(session));
  const { data: authListener } = supabase.auth.onAuthStateChange((event, session) => {
    getProfile(session);
    // Force entitlement refresh on auth boundary changes
    if (event === 'SIGNED_IN' || event === 'SIGNED_OUT' || event === 'TOKEN_REFRESHED' || event === 'USER_UPDATED') {
      try { (ent as any).refresh?.(); } catch {}
    }
    // Reset proactive nudge on explicit login/logout
    if (event === 'SIGNED_IN' || event === 'SIGNED_OUT') {
      setHasShownProactiveNudge(false);
      setShowUpgradeNudge(false);
    }
  });
    return () => {
      authListener.subscription.unsubscribe();
      if (conversationsChannelRef.current) {
        try { supabase.removeChannel(conversationsChannelRef.current); } catch {}
        conversationsChannelRef.current = null;
      }
    };
  }, []);

  // Prefetch achievements for signed-in users (streak removed)
  useEffect(() => {
    (async () => {
      try {
        const { data: { session } } = await supabase.auth.getSession();
        if (session) {
          try {
            const headers = { Authorization: `Bearer ${session.access_token}` };
            const ua = await fetch('/api/user/achievements', { headers }).catch(() => null);
            if (ua?.ok) {
              const j = await ua.json();
              if (Array.isArray(j?.ids)) setUnlockedAchievements(j.ids as string[]);
            }
          } catch {}
        }
      } catch {}
    })();
  }, []);

  useEffect(() => {
    if (conversationStatus === 'active' && isPro) {
      proTimerIntervalRef.current = setInterval(() => {
        setProConversationTimer(prev => {
          if (prev <= 1) { stopConversation('ended_by_limit'); return 0; }
          return prev - 1;
        });
      }, 1000);
    }
    return () => { if (proTimerIntervalRef.current) clearInterval(proTimerIntervalRef.current); };
  }, [conversationStatus, isPro]);

  // Free users: countdown daily remaining while session is active (moved below stopConversation)

  const startConversation = useCallback(async () => {
    // Gate free users with no remaining time
    if (!isPro && (dailySecondsRemaining ?? 0) <= 0) {
  promptPaywall('time_exhausted');
      return;
    }
  // Reset proactive nudge at the start of a new conversation session
  setHasShownProactiveNudge(false);
  setShowUpgradeNudge(false);
    setError(null);
  closePaywall();
    setViewMode('conversation');

  // Ensure the server has a loaded conversation
  if (conversationId) {
    try { wsSend({ type: 'load_conversation', conversationId }); } catch {}
  } else {
    // Reset messages locally and ask server to create one
    setMessages([]);
    try { wsSend({ type: 'create_conversation' }); } catch {}
  }

  setConversationStatus('active');
  setTurnStatus('listening');
  if (isPro) setProConversationTimer(proSessionSeconds);
  }, [session, isPro, conversationId, dailySecondsRemaining, promptPaywall, wsSend, proSessionSeconds]);

  const stopConversation = useCallback((reason: ConversationStatus = 'ended_by_user') => {
    // 1) Halt playback and fence late packets
    // 2) Disconnect WebSocket first to prevent late server replies
    try { (wsDisconnect as any)?.(); } catch {}
    // 3) Stop microphone and skip final flush so no tail blob is sent
    try { (stopMicrophone as any)({ skipFinalFlush: true }); } catch {}
    setExternalMicActive(false);
    if (audioPlayerRef.current) {
      try {
        if (typeof (audioPlayerRef.current as any).stop === 'function') {
          // Web Audio API source node
          (audioPlayerRef.current as any).stop();
        } else if (typeof (audioPlayerRef.current as any).pause === 'function') {
          // HTMLAudioElement
          (audioPlayerRef.current as any).pause();
        }
      } catch {}
      audioPlayerRef.current = null;
    }
    // Cancel any in-flight utterance processing to prevent stray replies
    try { inflightAbortRef.current?.abort(); } catch {}
    inflightAbortRef.current = null;
  // Summarization removed; titles and metadata handled server-side via WebSocket
    setConversationStatus(reason);
  setTurnStatus('idle');
    setMicVolume(0);
    if (reason === 'ended_by_limit') {
      // Ensure paywall opens when ending due to limit
      promptPaywall('time_exhausted');
    }
  }, [promptPaywall, stopMicrophone, wsDisconnect]);

  // Removed per-second client countdown for free users. We now trust server updates
  // and refresh after each turn and periodically via checkUsage().

  // Definitive automatic paywall logic (single source of truth)
  useEffect(() => {
    const { isLoading } = ent as { isLoading: boolean };

    // Wait for initial entitlement load; avoid running on null/unknown state
    if (isLoading || dailySecondsRemaining === null) return;

    // Condition: If the user is NOT pro AND their time is definitively zero or less...
    if (!isPro && dailySecondsRemaining <= 0) {
      if (conversationStatus === 'active') {
    stopConversation('ended_by_limit');
      } else {
    promptPaywall('time_exhausted');
      }
    }
  }, [isPro, dailySecondsRemaining, conversationStatus, ent.isLoading, stopConversation, promptPaywall]);

  // Proactive upgrade nudge when approaching limit (one-time until reset)
  useEffect(() => {
    const secs = dailySecondsRemaining ?? 0;
    if (!isPro && conversationStatus === 'active' && secs > 0 && secs <= 60 && !hasShownProactiveNudge) {
      setUpgradeNudgeSource('proactive_threshold');
      setShowUpgradeNudge(true);
      setHasShownProactiveNudge(true);
    }
  }, [isPro, conversationStatus, dailySecondsRemaining, hasShownProactiveNudge]);

  // Periodic entitlement refresh to sync remaining seconds
  useEffect(() => {
    const id = setInterval(() => { try { (ent as any).refresh?.(); } catch {} }, 30000);
    return () => clearInterval(id);
  }, [ent]);

  // Removed legacy HTTP pipeline; WebSocket handles STT/LLM/TTS. processAudioChunk deleted.

  // Public API for external microphone sources to submit encoded audio blobs
  const submitAudioChunk = useCallback(async (audio: Blob) => {
    if (wsStatus === 'connected' && audio && audio.size > MIN_AUDIO_BLOB_SIZE) {
      const ab = await audio.arrayBuffer();
      wsSend(ab);
      wsSend({ type: 'end_utterance' });
    } else if (wsStatus !== 'connected') {
      console.error('Cannot send audio: WebSocket is not connected.');
      setError('Not connected to the conversation server.');
    }
  }, [wsStatus, wsSend]);

  // Removed legacy VAD useEffect; microphone is managed by useConditionalMicrophone

  // Start microphone only when UI is in listening state AND WS is connected AND no external mic
  useEffect(() => {
    if (turnStatus === 'listening' && wsStatus === 'connected' && !externalMicActive) {
      try { startMicrophone(); } catch {}
    }
  }, [turnStatus, wsStatus, startMicrophone, externalMicActive]);

  // If we switch to external mic, stop the internal one and skip tail flush
  useEffect(() => {
    if (externalMicActive) {
      try { (stopMicrophone as any)({ skipFinalFlush: true }); } catch {}
    }
  }, [externalMicActive, stopMicrophone]);

  // Load a conversation's messages into provider
  // Note: loadConversation/newConversation/fetchAllConversations now provided by useConversationManager

  // Reset active conversation view (used after deletion) without full page reload
  const clearCurrentConversation = useCallback(() => {
    setConversationId(null);
    setMessages([]);
  }, [setConversationId, setMessages]);

  const value = {
    session,
    conversationId,
    currentConversationId: conversationId,
    messages,
  clearCurrentConversation,
    conversationStatus,
    turnStatus,
    startConversation,
    stopConversation,
    secondsRemaining: proConversationTimer,
    isPro,
  micVolume,
  kiraVolume,
    error,
    allConversations,
    loadConversation: async (id: string) => {
      // Load messages via HTTP for UI, and tell WS to seed context
      try {
        setConversationId(id);
        setMessages([]);
        setViewMode('conversation');
        try { wsSend({ type: 'load_conversation', conversationId: id }); } catch {}
        const { data: { session: sess } } = await supabase.auth.getSession();
        if (!sess) return;
        const res = await fetch(`/api/conversations/${id}/messages`, { headers: { Authorization: `Bearer ${sess.access_token}` } });
        if (!res.ok) return;
        const data = await res.json().catch(() => ({}));
        if (Array.isArray(data?.messages)) {
          setMessages(data.messages.map((m: any) => ({ id: m.id, role: m.role, content: m.content })));
        }
      } catch (e) {
        console.warn('Failed to load conversation', id, e);
      }
    },
    newConversation: async () => {
      try {
        setConversationId(null);
        setMessages([]);
        setViewMode('conversation');
        wsSend({ type: 'create_conversation' });
      } catch (e) {
        console.error('Failed to create conversation via WS', e);
      }
    },
    fetchAllConversations: async () => {
      try {
        const list = await listConversations();
        setAllConversations(list as any);
      } catch (e) {
        console.error('Failed to fetch conversations', e);
        setAllConversations([]);
      }
    },
    dailySecondsRemaining,
  dailyLimitSeconds: ent.dailyLimitSeconds,
    viewMode,
    setViewMode,
  paywallSource,
  promptPaywall,
  closePaywall,
  showUpgradeNudge,
  setShowUpgradeNudge,
  upgradeNudgeSource,
    unlockedAchievements,
    newlyUnlockedToast,
    setNewlyUnlockedToast,
  submitAudioChunk,
  externalMicActive,
  setExternalMicActive,
  };
  return <ConversationContext.Provider value={value}>{children}</ConversationContext.Provider>;
}

export function useConversation() {
  const context = useContext(ConversationContext);
  if (context === undefined) throw new Error('useConversation must be used within a ConversationProvider');
  return context;
}
