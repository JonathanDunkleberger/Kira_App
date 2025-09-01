'use client';

import { createContext, useContext, useState, useEffect, useRef, useCallback } from 'react';
import { supabase } from '@/lib/supabaseClient';
import { playMp3Base64, playAndAnalyzeAudio } from '@/lib/audio';
import { Session } from '@supabase/supabase-js';
import { createConversation as apiCreateConversation, listConversations } from '@/lib/client-api';
import { useConversationManager } from '@/lib/hooks/useConversationManager';
import { checkAchievements } from '@/lib/achievements';
import { useEntitlement } from '@/lib/hooks/useEntitlement';

// Increase minimum size to avoid short/noise causing 400 errors
const MIN_AUDIO_BLOB_SIZE = 4000;

type TurnStatus = 'idle' | 'user_listening' | 'processing_speech' | 'assistant_speaking';
type ConversationStatus = 'idle' | 'active' | 'ended_by_user' | 'ended_by_limit';
type Message = { role: 'user' | 'assistant'; content: string; id: string };
type Convo = { id: string; title: string | null; updated_at: string };
type ViewMode = 'conversation' | 'history';

interface ConversationContextType {
  session?: Session | null;
  conversationId: string | null;
  currentConversationId?: string | null;
  messages: Message[];
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
  showPaywall: boolean;
  setShowPaywall: (open: boolean) => void;
  promptPaywall: () => void;
  // proactive upgrade nudge
  showUpgradeNudge?: boolean;
  setShowUpgradeNudge?: (open: boolean) => void;
  upgradeNudgeSource?: 'last_turn' | 'proactive_threshold';
  unlockedAchievements?: string[];
  newlyUnlockedToast?: { id: string; name: string; description?: string | null } | null;
  setNewlyUnlockedToast?: (val: { id: string; name: string; description?: string | null } | null) => void;
}

const ConversationContext = createContext<ConversationContextType | undefined>(undefined);

export default function ConversationProvider({ children }: { children: React.ReactNode }) {
  const [session, setSession] = useState<Session | null>(null);
  const [isPro, setIsPro] = useState(false);
  const {
    conversationId, setConversationId,
    messages, setMessages,
    allConversations, setAllConversations,
    viewMode, setViewMode,
    loadConversation, newConversation, fetchAllConversations,
  } = useConversationManager(session);
  const [conversationStatus, setConversationStatus] = useState<ConversationStatus>('idle');
  const [turnStatus, setTurnStatus] = useState<TurnStatus>('idle');
  const [micVolume, setMicVolume] = useState(0);
  const [kiraVolume, setKiraVolume] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const [dailySecondsRemaining, setDailySecondsRemaining] = useState<number>(0);
  const [unlockedAchievements, setUnlockedAchievements] = useState<string[]>([]);
  const [newlyUnlockedToast, setNewlyUnlockedToast] = useState<{ id: string; name: string; description?: string | null } | null>(null);
  const [showPaywall, setShowPaywallState] = useState(false);
  const setShowPaywall = useCallback((open: boolean) => setShowPaywallState(open), []);
  const promptPaywall = useCallback(() => setShowPaywall(true), [setShowPaywall]);
  // proactive nudge state
  const [showUpgradeNudge, setShowUpgradeNudge] = useState(false);
  const [hasShownProactiveNudge, setHasShownProactiveNudge] = useState(false);
  const [upgradeNudgeSource, setUpgradeNudgeSource] = useState<'last_turn' | 'proactive_threshold'>('last_turn');
  const conversationsChannelRef = useRef<any>(null);
  const [proConversationTimer, setProConversationTimer] = useState(1800);
  const [proSessionSeconds, setProSessionSeconds] = useState(1800);
  const proTimerIntervalRef = useRef<NodeJS.Timeout | null>(null);
  const ent = useEntitlement();
  const mediaRecorderRef = useRef<MediaRecorder | null>(null);
  const audioChunksRef = useRef<Blob[]>([]);
  const audioPlayerRef = useRef<HTMLAudioElement | null>(null);
  const vadCleanupRef = useRef<() => void>(() => {});
  const isProcessingRef = useRef(false);
  const inflightAbortRef = useRef<AbortController | null>(null);

  // Sync entitlement -> provider state
  useEffect(() => {
    if (!ent.isLoading) {
      const pro = ent.userStatus === 'pro';
      setIsPro(pro);
      setDailySecondsRemaining(ent.secondsRemaining);
      setProSessionSeconds(ent.proSessionLimit || 1800);
      if (pro && conversationStatus === 'active') {
        setProConversationTimer(ent.proSessionLimit || 1800);
      }
    }
  }, [ent.isLoading, ent.userStatus, ent.secondsRemaining, ent.proSessionLimit, conversationStatus]);

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
  listConversations().then(setAllConversations).catch(() => setAllConversations([]));
        // Realtime updates
        if (conversationsChannelRef.current) {
          try { supabase.removeChannel(conversationsChannelRef.current); } catch {}
        }
        conversationsChannelRef.current = supabase
          .channel('conversations-provider')
          .on('postgres_changes', { event: '*', schema: 'public', table: 'conversations' }, () => {
            listConversations().then(setAllConversations).catch(() => {});
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
      promptPaywall();
      return;
    }
  // Reset proactive nudge at the start of a new conversation session
  setHasShownProactiveNudge(false);
  setShowUpgradeNudge(false);
    setError(null);
  setShowPaywall(false);
    setViewMode('conversation');

    let currentConvId = session ? conversationId : null;

    if (!currentConvId) {
      try {
        const newConversation = await apiCreateConversation('New Conversation');
        setConversationId(newConversation.id);
        currentConvId = newConversation.id;
        setMessages([]);
        // Persist guest identity so we can fetch remaining time and later claim it after signup
        if (!session) {
          try { localStorage.setItem('kiraGuestId', newConversation.id); } catch {}
        }
        // refresh list for signed-in users only
        if (session) listConversations().then(setAllConversations).catch(() => {});
      } catch (e: any) {
        setError(`Failed to create conversation: ${e.message}`);
        return;
      }
    }

    setConversationStatus('active');
    setTurnStatus('user_listening');
  if (isPro) setProConversationTimer(proSessionSeconds);
  }, [session, isPro, conversationId, dailySecondsRemaining, promptPaywall]);

  const stopConversation = useCallback((reason: ConversationStatus = 'ended_by_user') => {
    vadCleanupRef.current();
    if (mediaRecorderRef.current?.state === 'recording') mediaRecorderRef.current.stop();
    mediaRecorderRef.current?.stream.getTracks().forEach(track => track.stop());
    mediaRecorderRef.current = null;
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
    // Fire-and-forget summarization of the conversation just before idling
    try {
      if (conversationId) {
        const headers: Record<string, string> = { 'Content-Type': 'application/json' };
        if (session?.access_token) headers['Authorization'] = `Bearer ${session.access_token}`;
        fetch('/api/summarize', {
          method: 'POST',
          headers,
          body: JSON.stringify({ conversationId }),
        }).catch(() => {});
      }
    } catch {}
  setConversationStatus(reason);
  setTurnStatus('idle');
    setMicVolume(0);
    if (reason === 'ended_by_limit') {
      // Ensure paywall opens when ending due to limit
      promptPaywall();
    }
  }, [promptPaywall]);

  // Removed per-second client countdown for free users. We now trust server updates
  // and refresh after each turn and periodically via checkUsage().

  // Definitive automatic paywall logic (single source of truth)
  useEffect(() => {
    // Condition: If the user is NOT pro AND their time is zero or less...
    if (!isPro && (dailySecondsRemaining ?? 0) <= 0) {
      // If a conversation is currently active, stop it first.
      // The stopConversation function will then trigger the paywall.
      if (conversationStatus === 'active') {
        stopConversation('ended_by_limit');
      } else {
        // If no conversation is active, just show the paywall directly.
        promptPaywall();
      }
    }
  }, [isPro, dailySecondsRemaining, conversationStatus]);

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

  const processAudioChunk = useCallback(async (audioBlob: Blob) => {
    if (isProcessingRef.current) return;
    isProcessingRef.current = true;
    // If conversation is no longer active, drop the chunk
    if (conversationStatus !== 'active') { isProcessingRef.current = false; return; }
    setTurnStatus('processing_speech');
    setMicVolume(0);
    
    const formData = new FormData();
    formData.append('audio', audioBlob, 'audio.webm');
  // No need to pass guest history; guests now have a server conversationId after first turn
    
    const url = new URL('/api/utterance', window.location.origin);
    if (conversationId) url.searchParams.set('conversationId', conversationId);
    // Prepare abort controller so we can cancel on stop
    const abort = new AbortController();
    inflightAbortRef.current = abort;
    
    try {
  const response = await fetch(url.toString(), {
        method: 'POST',
        headers: session?.access_token ? { 'Authorization': `Bearer ${session.access_token}` } : {},
        body: formData,
        signal: abort.signal,
      });

      // Improved error handling
      if (response.status === 402) {
        // Server paywall enforcement; centralize paywall via stopConversation
        stopConversation('ended_by_limit');
        throw new Error('Daily time limit exceeded.');
      }
      if (!response.ok || !response.body) {
          const errorText = await response.text();
          if(response.status === 401 && !session) {
              throw new Error('Guest session expired or invalid. Please sign in to continue.');
          }
          throw new Error(errorText || `API Error (${response.status})`);
      }
      
  const userTranscript = decodeURIComponent(response.headers.get('X-User-Transcript') || '');
  setMessages(prev => [...prev, { role: 'user', content: userTranscript, id: crypto.randomUUID() }]);
      
  const assistantMessageId = crypto.randomUUID();
  setMessages(prev => [...prev, { role: 'assistant', content: '', id: assistantMessageId }]);
      if (conversationStatus !== 'active') { throw new Error('Conversation inactive'); }
      setTurnStatus('assistant_speaking');
  // Legacy last-turn nudge removed; automatic paywall watcher now handles gating
      
      let fullAssistantReply = '';
      const reader = response.body.getReader();
      const decoder = new TextDecoder();
  while (true) {
        const { value, done } = await reader.read();
        if (done) break;
        const chunk = decoder.decode(value);
        fullAssistantReply += chunk;
        setMessages(prev => prev.map(msg => msg.id === assistantMessageId ? { ...msg, content: fullAssistantReply } : msg));
      }

      // Auto-title after second turn for signed-in users with untitled conversations
      try {
        if (session && conversationId) {
          const userCount = [...messages, { role: 'assistant', content: fullAssistantReply, id: 'tmp' } as Message]
            .filter(m => m.role === 'user').length;
          if (userCount >= 2) {
            // Title based on the first user message
            const firstUser = [...messages].find(m => m.role === 'user');
            const base = firstUser?.content || userTranscript;
            const title = base.trim().slice(0, 60).replace(/\s+/g, ' ');
            // Only patch if currently generic
            const current = allConversations.find(c => c.id === conversationId)?.title || '';
            if (!current || /new chat|new conversation/i.test(current)) {
              await fetch(`/api/conversations/${conversationId}`, {
                method: 'PATCH',
                headers: { 'Content-Type': 'application/json', ...(session?.access_token ? { Authorization: `Bearer ${session.access_token}` } : {}) },
                body: JSON.stringify({ title })
              }).catch(() => {});
              listConversations().then(setAllConversations).catch(() => {});
            }
          }
        }
      } catch {}

      try {
        const audioRes = await fetch('/api/synthesize', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ text: fullAssistantReply })
        });

        if (audioRes.ok) {
          const { audioMp3Base64 } = await audioRes.json();
          if (audioMp3Base64) {
            audioPlayerRef.current = await playAndAnalyzeAudio(
              audioMp3Base64,
              (v) => setKiraVolume(v),
              () => {
                // Only transition back to listening if still active
                if (conversationStatus === 'active') setTurnStatus('user_listening');
              }
            );
          } else {
            if (conversationStatus === 'active') setTurnStatus('user_listening');
          }
        } else {
          console.error('Speech synthesis failed.');
          if (conversationStatus === 'active') setTurnStatus('user_listening');
        }
      } catch (ttsError) {
        console.error('Error during TTS playback:', ttsError);
        if (conversationStatus === 'active') setTurnStatus('user_listening');
      }
      // Refresh daily seconds after a turn for signed-in users (server truth)
      if (session) {
        // Refresh entitlement from server after a completed turn
        try { (ent as any).refresh?.(); } catch {}
        // Achievements: compute and persist newly unlocked
        try {
          const messagesCount = [...messages, { role: 'assistant', content: fullAssistantReply, id: 'tmp' } as any].length;
          const conversationCount = allConversations.length;
          // memoryCount requires a server call; approximate via dedicated API
          let memoryCount = 0;
          try {
            const res = await fetch('/api/memory', { method: 'GET', headers: { Authorization: `Bearer ${session.access_token}` } });
            if (res.ok) {
              const j = await res.json();
              memoryCount = Number(j?.count ?? 0);
            }
          } catch {}
          const newly = checkAchievements({ messagesCount, conversationCount, memoryCount, unlockedAchievements });
          if (newly.length) {
            setUnlockedAchievements(prev => Array.from(new Set([...prev, ...newly])));
            // best-effort insert
            await fetch('/api/user/achievements', {
              method: 'POST',
              headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${session.access_token}` },
              body: JSON.stringify({ ids: newly })
            }).catch(() => {});
            // TODO: show toast UI here in a future pass
          }
        } catch {}
      } else {
        // Guests: entitlement hook will refresh on interval; optionally force refresh
        try { (ent as any).refresh?.(); } catch {}
      }
      
    } catch (e: any) {
      if (e?.name === 'AbortError') {
        // Silently ignore aborted requests
      } else {
        setError(e.message || 'Audio processing failed');
      }
      // Ensure we return to idle/listening state appropriately
      if (conversationStatus === 'active') {
        setTurnStatus('user_listening');
      }
    } finally {
      isProcessingRef.current = false;
      inflightAbortRef.current = null;
    }
  }, [session, conversationId, stopConversation, messages, allConversations, conversationStatus]);

  // Strictly turn-based VAD: only active during user_listening
  useEffect(() => {
    let vadAndStream: { vad: any; stream: MediaStream } | null = null;

    const setupVAD = async () => {
      try {
        const { MicVAD } = await import('@ricky0123/vad-web');
        const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
        const vad = await MicVAD.new({
          stream,
          minSpeechFrames: 6,
          redemptionFrames: 30,
          positiveSpeechThreshold: 0.6,
          negativeSpeechThreshold: 0.35,
          preSpeechPadFrames: 4,
          // @ts-expect-error level provided at runtime
          onVADMisfire: (level: number) => {
            const v = typeof level === 'number' && isFinite(level) ? Math.max(0, Math.min(1, level)) : 0;
            setMicVolume(v);
          },
          onSpeechStart: () => {
            if (mediaRecorderRef.current?.state === 'recording') {
              try { mediaRecorderRef.current.stop(); } catch {}
            }
            mediaRecorderRef.current = null;
            audioChunksRef.current = [];
            mediaRecorderRef.current = new MediaRecorder(stream, { mimeType: 'audio/webm' });
            mediaRecorderRef.current.ondataavailable = (event) => {
              audioChunksRef.current.push(event.data);
            };
            mediaRecorderRef.current.onstop = () => {
              const audioBlob = new Blob(audioChunksRef.current, { type: 'audio/webm' });
              if (audioBlob.size > MIN_AUDIO_BLOB_SIZE) {
                if (turnStatus === 'user_listening' && conversationStatus === 'active') {
                  processAudioChunk(audioBlob);
                }
              } else {
                setMicVolume(0);
              }
            };
            mediaRecorderRef.current.start();
          },
          onSpeechEnd: () => {
            if (mediaRecorderRef.current?.state === 'recording') {
              mediaRecorderRef.current.stop();
            }
            setMicVolume(0);
          },
        });
        vad.start();
        vadAndStream = { vad, stream };
        vadCleanupRef.current = () => {
          try { vad.destroy(); } catch {}
          try { stream.getTracks().forEach((t) => t.stop()); } catch {}
          setMicVolume(0);
        };
      } catch (err) {
        console.error('VAD or Microphone setup failed:', err);
        setError('Microphone access was denied. Please check your browser settings.');
        stopConversation('ended_by_user');
      }
    };

    if (turnStatus === 'user_listening') {
      setupVAD();
    }

    return () => {
      if (vadAndStream) {
        try { vadAndStream.vad.destroy(); } catch {}
        try { vadAndStream.stream.getTracks().forEach((t: MediaStreamTrack) => t.stop()); } catch {}
      }
    };
  }, [turnStatus]);

  // Load a conversation's messages into provider
  // Note: loadConversation/newConversation/fetchAllConversations now provided by useConversationManager

  const value = {
    session,
    conversationId,
    currentConversationId: conversationId,
    messages,
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
    loadConversation,
    newConversation,
    fetchAllConversations,
    dailySecondsRemaining,
  dailyLimitSeconds: ent.dailyLimitSeconds,
    viewMode,
    setViewMode,
    showPaywall,
    setShowPaywall,
    promptPaywall,
  showUpgradeNudge,
  setShowUpgradeNudge,
  upgradeNudgeSource,
    unlockedAchievements,
    newlyUnlockedToast,
    setNewlyUnlockedToast,
  };
  return <ConversationContext.Provider value={value}>{children}</ConversationContext.Provider>;
}

export function useConversation() {
  const context = useContext(ConversationContext);
  if (context === undefined) throw new Error('useConversation must be used within a ConversationProvider');
  return context;
}
