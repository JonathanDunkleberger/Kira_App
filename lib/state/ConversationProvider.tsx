'use client';

import { createContext, useContext, useState, useEffect, useRef, useCallback } from 'react';
import { usePaywallBase } from '@/lib/hooks/usePaywall';
import { supabase } from '@/lib/supabaseClient';
import { playMp3Base64 } from '@/lib/audio';
import { Session } from '@supabase/supabase-js';
import { createConversation as apiCreateConversation, listConversations, getConversation, fetchEntitlement } from '@/lib/client-api';
import { useConversationManager } from '@/lib/hooks/useConversationManager';
import { checkAchievements } from '@/lib/achievements';

const MIN_AUDIO_BLOB_SIZE = 1000; // ignore tiny/noise chunks

type TurnStatus = 'idle' | 'user_listening' | 'processing_speech' | 'assistant_speaking';
type ConversationStatus = 'idle' | 'active' | 'ended_by_user' | 'ended_by_limit';
type Message = { role: 'user' | 'assistant'; content: string; id: string };
type Convo = { id: string; title: string | null; updated_at: string };
type ViewMode = 'conversation' | 'history';

interface ConversationContextType {
  session?: Session | null;
  conversationId: string | null;
  currentConversationId?: string | null; // alias for convenience
  messages: Message[];
  conversationStatus: ConversationStatus;
  turnStatus: TurnStatus;
  startConversation: () => void;
  stopConversation: (reason?: ConversationStatus) => void;
  secondsRemaining: number;
  isPro: boolean;
  micVolume: number;
  error: string | null;
  // Centralized conversations state
  allConversations: Convo[];
  loadConversation: (id: string) => Promise<void>;
  newConversation: () => Promise<void>;
  fetchAllConversations: () => Promise<void>;
  // Timer surface (daily remaining for free users)
  dailySecondsRemaining: number | null;
  // View mode state
  viewMode: ViewMode;
  setViewMode: (mode: ViewMode) => void;
  // Paywall control
  showPaywall: boolean;
  setShowPaywall: (open: boolean) => void;
  promptPaywall: () => void;
  // Upgrade nudge (last-turn snackbar)
  showUpgradeNudge: boolean;
  setShowUpgradeNudge: (open: boolean) => void;
  // Streak
  currentStreak: number | null;
  hasPostedToday: boolean;
  // Daily topic
  dailyTopic?: string | null;
  // Achievements (lean V1)
  unlockedAchievements?: string[];
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
  const [error, setError] = useState<string | null>(null);
  const [dailySecondsRemaining, setDailySecondsRemaining] = useState<number | null>(null);
  const [currentStreak, setCurrentStreak] = useState<number | null>(null);
  const [hasPostedToday, setHasPostedToday] = useState(false);
  const [dailyTopic, setDailyTopic] = useState<string | null>(null);
  const [unlockedAchievements, setUnlockedAchievements] = useState<string[]>([]);
  // Centralize paywall state via hook
  const {
    isOpen: paywallOpen,
    triggerPaywall,
    dismissPaywall,
    secondsRemaining: paywallSeconds,
    isPro: paywallIsPro,
    checkUsage,
  } = usePaywallBase({
    session,
    contextIsPro: isPro,
    dailySecondsRemaining,
    promptPaywall: () => setShowPaywall(true),
    setShowPaywall: (open: boolean) => setShowPaywallState(open),
  });
  const [showPaywall, setShowPaywallState] = useState(false);
  const [showUpgradeNudge, setShowUpgradeNudge] = useState(false);
  const recentlyClosedRef = useRef(false);
  const setShowPaywall = useCallback((open: boolean) => {
    // Only update local state; avoid calling hook's trigger/dismiss to prevent recursion
    setShowPaywallState(open);
  }, []);
  const promptPaywall = useCallback(() => setShowPaywall(true), [setShowPaywall]);
  const conversationsChannelRef = useRef<any>(null);
  // Listen for snackbar dismiss to debounce re-nudging briefly
  useEffect(() => {
    const onDismiss = () => { recentlyClosedRef.current = true; setTimeout(() => { recentlyClosedRef.current = false; }, 3000); };
    window.addEventListener('upgrade_nudge:dismissed', onDismiss);
    return () => window.removeEventListener('upgrade_nudge:dismissed', onDismiss);
  }, []);
  
  const [proConversationTimer, setProConversationTimer] = useState(1800);
  const [proSessionSeconds, setProSessionSeconds] = useState(1800);
  const proTimerIntervalRef = useRef<NodeJS.Timeout | null>(null);
  const mediaRecorderRef = useRef<MediaRecorder | null>(null);
  const audioChunksRef = useRef<Blob[]>([]);
  const audioPlayerRef = useRef<HTMLAudioElement | null>(null);
  const vadCleanupRef = useRef<() => void>(() => {});
  const isProcessingRef = useRef(false);

  useEffect(() => {
    const getProfile = async (currentSession: Session | null) => {
      setSession(currentSession);
      if (currentSession) {
        // Attempt to claim a guest conversation if present in URL or session
        try {
          const urlParams = new URLSearchParams(window.location.search);
          const urlGuestConv = urlParams.get('guestConvId');
          const storedGuestConv = typeof window !== 'undefined' ? sessionStorage.getItem('guestConversationId') : null;
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
            try { sessionStorage.removeItem('guestConversationId'); } catch {}
            if (urlGuestConv) {
              urlParams.delete('guestConvId');
              const qs = urlParams.toString();
              window.history.replaceState({}, '', `${window.location.pathname}${qs ? `?${qs}` : ''}`);
            }
          }
        } catch (e) {
          console.warn('Guest conversation claim failed:', e);
        }
        // LOGGED-IN users
        const ent = await fetchEntitlement().catch(() => null);
        setIsPro(ent?.status === 'active');
        setDailySecondsRemaining(typeof ent?.secondsRemaining === 'number' ? ent!.secondsRemaining : null);
        // Baseline the session timer for Pro users only
        if (ent?.status === 'active') {
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
      } else {
        // GUEST users: server-authoritative remaining seconds
        setIsPro(false);
        try {
          const guestConvId = sessionStorage.getItem('guestConversationId');
          if (guestConvId) {
            const res = await fetch(`/api/conversations/guest/${guestConvId}`);
            if (res.ok) {
              const j = await res.json();
              setDailySecondsRemaining(Number(j?.secondsRemaining ?? 0));
            } else {
              // If not found or expired, fall back to default from config
              const cfgRes = await fetch('/api/config');
              const cfg = await cfgRes.json().catch(() => ({}));
              setDailySecondsRemaining(Number(cfg?.freeTrialSeconds ?? 900));
              setProSessionSeconds(Number(cfg?.proSessionSeconds ?? 1800));
            }
          } else {
            const cfgRes = await fetch('/api/config');
            const cfg = await cfgRes.json().catch(() => ({}));
            setDailySecondsRemaining(Number(cfg?.freeTrialSeconds ?? 900));
            setProSessionSeconds(Number(cfg?.proSessionSeconds ?? 1800));
          }
        } catch {
          setDailySecondsRemaining(900);
        }
      }
    };

    supabase.auth.getSession().then(({ data: { session } }) => getProfile(session));
    const { data: authListener } = supabase.auth.onAuthStateChange((_event, session) => { getProfile(session); });
    return () => {
      authListener.subscription.unsubscribe();
      if (conversationsChannelRef.current) {
        try { supabase.removeChannel(conversationsChannelRef.current); } catch {}
        conversationsChannelRef.current = null;
      }
    };
  }, []);

  // Fetch current streak and daily topic on load
  useEffect(() => {
    (async () => {
      try {
        const { data: { session } } = await supabase.auth.getSession();
        if (session) {
          // Fetch unlocked achievements
          try {
            const r = await fetch('/api/usage', { headers: { Authorization: `Bearer ${session.access_token}` } });
            // fallback: if /api/usage not relevant, we still try to fetch user_achievements directly via RPC
          } catch {}
          try {
            const headers = { Authorization: `Bearer ${session.access_token}` };
            const res = await fetch('/api/analytics/paywall', { headers });
            // ignore, placeholder to warm auth in edge
          } catch {}
          try {
            const headers = { Authorization: `Bearer ${session.access_token}` };
            const ua = await fetch('/api/user/achievements', { headers }).catch(() => null);
            if (ua?.ok) {
              const j = await ua.json();
              if (Array.isArray(j?.ids)) setUnlockedAchievements(j.ids as string[]);
            }
          } catch {}
          const r = await fetch('/api/streak/get', { headers: { Authorization: `Bearer ${session.access_token}` } });
          const j = await r.json().catch(() => ({}));
          if (r.ok) setCurrentStreak(Number(j?.currentStreak ?? 0));
        } else {
          setCurrentStreak(null);
        }
      } catch {}
      try {
        const t = await fetch('/api/daily-topic').then(r => r.json()).catch(() => null);
        setDailyTopic(t?.topic ?? null);
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
        // Persist guest conversation id so we can fetch remaining time and later claim it after signup
        if (!session) {
          try { sessionStorage.setItem('guestConversationId', newConversation.id); } catch {}
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
    if (audioPlayerRef.current) { audioPlayerRef.current.pause(); audioPlayerRef.current = null; }
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
    // Hide upgrade nudge when ending a conversation
    setShowUpgradeNudge(false);
  if (reason === 'ended_by_limit') {
      // Ensure paywall opens when ending due to limit
      promptPaywall();
  recentlyClosedRef.current = true;
    }
  }, [promptPaywall]);

  // Removed per-second client countdown for free users. We now trust server updates
  // and refresh after each turn and periodically via checkUsage().

  // Trigger paywall if daily time becomes exhausted regardless of session state
  useEffect(() => {
    // Prevent loop by bailing if paywall is already shown
    if (!isPro && dailySecondsRemaining !== null && dailySecondsRemaining <= 0 && !showPaywall) {
      if (conversationStatus === 'active') {
        // Let stopConversation handle cleanup and opening the paywall last
        stopConversation('ended_by_limit');
      } else {
        setShowPaywall(true);
      }
    }
  }, [dailySecondsRemaining, isPro, conversationStatus, stopConversation, showPaywall]);

  // Handle landing-on-page with zero time left (no active conversation)
  useEffect(() => {
    if (!isPro && (dailySecondsRemaining ?? 0) <= 0 && !showPaywall) {
      promptPaywall();
    }
  }, [isPro, dailySecondsRemaining, showPaywall, promptPaywall]);

  // Periodic usage checks to sync paywall
  useEffect(() => {
    const id = setInterval(() => { checkUsage().catch(() => {}); }, 30000);
    return () => clearInterval(id);
  }, [checkUsage]);

  const processAudioChunk = useCallback(async (audioBlob: Blob) => {
    if (isProcessingRef.current) return;
    isProcessingRef.current = true;
    setTurnStatus('processing_speech');
    setMicVolume(0);
    
    const formData = new FormData();
    formData.append('audio', audioBlob, 'audio.webm');
  // No need to pass guest history; guests now have a server conversationId after first turn
    
    const url = new URL('/api/utterance', window.location.origin);
    if (conversationId) url.searchParams.set('conversationId', conversationId);
    
    try {
  const response = await fetch(url.toString(), {
        method: 'POST',
        headers: session?.access_token ? { 'Authorization': `Bearer ${session.access_token}` } : {},
        body: formData,
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
      setTurnStatus('assistant_speaking');
  const shouldTriggerPaywall = response.headers.get('X-Paywall-Trigger') === 'true';
      if (shouldTriggerPaywall && !isPro) {
        // soft earcon cue
        import('@/lib/audio').then(m => m.playEarcon().catch(() => {})).catch(() => {});
        if (!showPaywall && !recentlyClosedRef.current) {
          setShowUpgradeNudge(true);
          // Cooldown to avoid immediate re-open after modal close
          window.setTimeout(() => { recentlyClosedRef.current = false; }, 3000);
        }
      }
      
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
            audioPlayerRef.current = await playMp3Base64(audioMp3Base64, () => {
              if (shouldTriggerPaywall) {
                stopConversation('ended_by_limit');
              } else {
                setTurnStatus('user_listening');
              }
            });
          } else {
            if (shouldTriggerPaywall) {
              stopConversation('ended_by_limit');
            } else {
              setTurnStatus('user_listening');
            }
          }
        } else {
          console.error('Speech synthesis failed.');
          if (shouldTriggerPaywall) {
            stopConversation('ended_by_limit');
          } else {
            setTurnStatus('user_listening');
          }
        }
      } catch (ttsError) {
        console.error('Error during TTS playback:', ttsError);
        if (shouldTriggerPaywall) {
          stopConversation('ended_by_limit');
        } else {
          setTurnStatus('user_listening');
        }
      }
      // Refresh daily seconds after a turn for signed-in users (server truth)
      if (session) {
        fetchEntitlement().then(ent => {
          if (ent) setDailySecondsRemaining(ent.secondsRemaining);
        }).catch(() => {});
        // Update streak once per day
        if (!hasPostedToday) {
          try {
            const r = await fetch('/api/streak/update', { method: 'POST', headers: { Authorization: `Bearer ${session.access_token}` } });
            const j = await r.json().catch(() => ({}));
            if (r.ok && typeof j?.currentStreak === 'number') {
              setCurrentStreak(j.currentStreak);
              setHasPostedToday(true);
            }
          } catch {}
        }
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
        // Guests: refresh remaining seconds from server for the current conversation
        try {
          const guestConvId = conversationId || (typeof window !== 'undefined' ? sessionStorage.getItem('guestConversationId') : null);
          if (guestConvId) {
            const res = await fetch(`/api/conversations/guest/${guestConvId}`);
            if (res.ok) {
              const j = await res.json();
              const remaining = Number(j?.secondsRemaining ?? 0);
              setDailySecondsRemaining(remaining);
              if (remaining <= 0) {
                stopConversation('ended_by_limit');
              }
            }
          }
        } catch {
          // Silent fallback: keep previous value
        }
      }
      
    } catch (e: any) { setError(e.message); stopConversation('ended_by_user'); }
    finally { isProcessingRef.current = false; }
  }, [session, conversationId, stopConversation, messages, allConversations]);

  useEffect(() => {
    // Robust VAD setup: always rebuild on state changes and ensure full teardown
    let vadAndStream: { vad: any; stream: MediaStream } | null = null;

    const setupVAD = async () => {
      try {
        const { MicVAD } = await import('@ricky0123/vad-web');
        const stream = await navigator.mediaDevices.getUserMedia({ audio: true });

        const vad = await MicVAD.new({
          stream,
          // --- START VAD TUNING FIX ---
          // Less sensitive to brief noises; require longer sustained speech and longer silence to end.
          // 15 frames (~480ms at 16kHz) before firing onSpeechStart
          minSpeechFrames: 15,
          // 75 frames (~2.4s of silence) before firing onSpeechEnd
          redemptionFrames: 75,
          // --- END VAD TUNING FIX ---
          onSpeechStart: () => {
            // Start recording when speech begins
            // Guard: stop and clear any lingering recorder from a previous turn
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
                processAudioChunk(audioBlob);
              }
            };
            mediaRecorderRef.current.start();
          },
          onSpeechEnd: () => {
            if (mediaRecorderRef.current?.state === 'recording') {
              mediaRecorderRef.current.stop();
            }
          },
        });

        // Start VAD and retain handles for cleanup
        vad.start();
        vadAndStream = { vad, stream };
        vadCleanupRef.current = () => {
          try { vad.destroy(); } catch {}
          try { stream.getTracks().forEach((t) => t.stop()); } catch {}
        };
      } catch (err) {
        console.error('VAD or Microphone setup failed:', err);
        setError('Microphone access was denied. Please check your browser settings.');
        stopConversation('ended_by_user');
      }
    };

  if (!showPaywall && conversationStatus === 'active' && turnStatus === 'user_listening') {
      // barge-in: stop any assistant audio currently playing
      if (audioPlayerRef.current) {
        audioPlayerRef.current.pause();
        audioPlayerRef.current = null;
      }
      setupVAD();
    }

    // Critical cleanup on dependency changes/unmount
    return () => {
      if (vadAndStream) {
        try { vadAndStream.vad.destroy(); } catch {}
        try { vadAndStream.stream.getTracks().forEach((t: MediaStreamTrack) => t.stop()); } catch {}
      }
    };
  }, [conversationStatus, turnStatus, processAudioChunk, stopConversation, showPaywall]);

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
    error,
    allConversations,
    loadConversation,
    newConversation,
    fetchAllConversations,
    dailySecondsRemaining,
  viewMode,
  setViewMode,
  showPaywall: showPaywall || paywallOpen,
  setShowPaywall,
  promptPaywall,
  showUpgradeNudge,
  setShowUpgradeNudge,
  currentStreak,
  hasPostedToday,
  dailyTopic,
  unlockedAchievements,
  };
  return <ConversationContext.Provider value={value}>{children}</ConversationContext.Provider>;
}

export function useConversation() {
  const context = useContext(ConversationContext);
  if (context === undefined) throw new Error('useConversation must be used within a ConversationProvider');
  return context;
}
