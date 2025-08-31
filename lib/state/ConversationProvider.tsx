'use client';

import { createContext, useContext, useState, useEffect, useRef, useCallback } from 'react';
import { supabase } from '@/lib/supabaseClient';
import { playMp3Base64 } from '@/lib/audio';
import { Session } from '@supabase/supabase-js';
import { createConversation as apiCreateConversation, listConversations, getConversation, fetchEntitlement } from '@/lib/client-api';

const PRO_SESSION_SECONDS = 30 * 60; // increased from 20 to 30 minutes
const GUEST_SESSION_SECONDS = 15 * 60;
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
}

const ConversationContext = createContext<ConversationContextType | undefined>(undefined);

export default function ConversationProvider({ children }: { children: React.ReactNode }) {
  const [session, setSession] = useState<Session | null>(null);
  const [isPro, setIsPro] = useState(false);
  const [conversationId, setConversationId] = useState<string | null>(null);
  const [messages, setMessages] = useState<Message[]>([]);
  const [conversationStatus, setConversationStatus] = useState<ConversationStatus>('idle');
  const [turnStatus, setTurnStatus] = useState<TurnStatus>('idle');
  const [micVolume, setMicVolume] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const [allConversations, setAllConversations] = useState<Convo[]>([]);
  const [dailySecondsRemaining, setDailySecondsRemaining] = useState<number | null>(null);
  const [viewMode, setViewMode] = useState<ViewMode>('conversation');
  const [showPaywall, setShowPaywall] = useState(false);
  const promptPaywall = useCallback(() => setShowPaywall(true), []);
  const conversationsChannelRef = useRef<any>(null);
  
  const [proConversationTimer, setProConversationTimer] = useState(PRO_SESSION_SECONDS);
  const proTimerIntervalRef = useRef<NodeJS.Timeout | null>(null);
  const mediaRecorderRef = useRef<MediaRecorder | null>(null);
  const audioChunksRef = useRef<Blob[]>([]);
  const audioPlayerRef = useRef<HTMLAudioElement | null>(null);
  const vadCleanupRef = useRef<() => void>(() => {});
  const isProcessingRef = useRef(false);

  useEffect(() => {
  const fetchProfile = async () => {
      const { data: { session } } = await supabase.auth.getSession();
      setSession(session);
      if (session) {
        const ent = await fetchEntitlement().catch(() => null);
        setIsPro(ent?.status === 'active');
        setDailySecondsRemaining(typeof ent?.secondsRemaining === 'number' ? ent!.secondsRemaining : null);
    // Baseline the session timer based on plan
    setProConversationTimer((ent?.status === 'active') ? PRO_SESSION_SECONDS : GUEST_SESSION_SECONDS);
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
        setIsPro(false);
      }
    };
    fetchProfile();
    const { data: authListener } = supabase.auth.onAuthStateChange((_event, session) => { setSession(session); fetchProfile(); });
    return () => {
      authListener.subscription.unsubscribe();
      if (conversationsChannelRef.current) {
        try { supabase.removeChannel(conversationsChannelRef.current); } catch {}
        conversationsChannelRef.current = null;
      }
    };
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
        // refresh list for signed-in users only
        if (session) listConversations().then(setAllConversations).catch(() => {});
      } catch (e: any) {
        setError(`Failed to create conversation: ${e.message}`);
        return;
      }
    }

    setConversationStatus('active');
    setTurnStatus('user_listening');
    setProConversationTimer(isPro ? PRO_SESSION_SECONDS : GUEST_SESSION_SECONDS);
  }, [session, isPro, conversationId, dailySecondsRemaining, promptPaywall]);

  const stopConversation = useCallback((reason: ConversationStatus = 'ended_by_user') => {
    vadCleanupRef.current();
    if (mediaRecorderRef.current?.state === 'recording') mediaRecorderRef.current.stop();
    mediaRecorderRef.current?.stream.getTracks().forEach(track => track.stop());
    mediaRecorderRef.current = null;
    if (audioPlayerRef.current) { audioPlayerRef.current.pause(); audioPlayerRef.current = null; }
    setConversationStatus(reason);
    setTurnStatus('idle');
    setMicVolume(0);
  }, []);

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
        // Server paywall enforcement
        setShowPaywall(true);
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
            audioPlayerRef.current = await playMp3Base64(audioMp3Base64, () => setTurnStatus('user_listening'));
          } else {
            setTurnStatus('user_listening');
          }
        } else {
          console.error('Speech synthesis failed.');
          setTurnStatus('user_listening');
        }
      } catch (ttsError) {
        console.error('Error during TTS playback:', ttsError);
        setTurnStatus('user_listening');
      }
      // Refresh daily seconds after a turn
      if (session) {
        fetchEntitlement().then(ent => {
          if (ent) setDailySecondsRemaining(ent.secondsRemaining);
        }).catch(() => {});
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

    if (conversationStatus === 'active' && turnStatus === 'user_listening') {
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
  }, [conversationStatus, turnStatus, processAudioChunk, stopConversation]);

  // Load a conversation's messages into provider
  const loadConversation = useCallback(async (id: string) => {
    // End any active session before loading a new one
    stopConversation('ended_by_user');
    setError(null);
    if (!session) return;
    try {
      const data = await getConversation(id);
      const msgs = (data?.messages || []) as Array<{ id: string; role: 'user'|'assistant'; content: string }>;
      setConversationId(id);
      setMessages(msgs.map(m => ({ id: m.id, role: m.role, content: m.content })));
      // Reset state ready for user input
      setConversationStatus('idle');
      setTurnStatus('idle');
      // Switch back to main conversation UI
      setViewMode('conversation');
    } catch (e: any) {
      setError('Failed to load conversation: ' + (e?.message || 'Unknown error'));
    }
  }, [session, stopConversation]);

  // Create conversation without starting mic
  const newConversation = useCallback(async () => {
    if (!session) return;
    try {
      const c = await apiCreateConversation('New Conversation');
      setConversationId(c.id);
      setMessages([]);
      listConversations().then(setAllConversations).catch(() => {});
    } catch {}
  }, [session]);

  // Expose explicit refresh of conversations list
  const fetchAllConversations = useCallback(async () => {
    if (!session) { setAllConversations([]); return; }
    try { const list = await listConversations(); setAllConversations(list); } catch { /* noop */ }
  }, [session]);

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
  showPaywall,
  setShowPaywall,
  promptPaywall,
  };
  return <ConversationContext.Provider value={value}>{children}</ConversationContext.Provider>;
}

export function useConversation() {
  const context = useContext(ConversationContext);
  if (context === undefined) throw new Error('useConversation must be used within a ConversationProvider');
  return context;
}
