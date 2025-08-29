'use client';

import { createContext, useContext, useState, useEffect, useRef, useCallback } from 'react';
import { supabase } from '@/lib/supabaseClient';
import { playMp3Base64 } from '@/lib/audio';
import type { Session } from '@supabase/supabase-js';
import { createConversation as apiCreateConversation, ensureAnonSession } from '@/lib/client-api';
import { initializeUsage, syncUsageWithServer, updateUsage } from '@/lib/usageTracking';

const PRO_CONVERSATION_LIMIT_SECONDS = 20 * 60; // 20 minutes
const FREE_TRIAL_LIMIT_SECONDS = 15 * 60; // 15 minutes

type TurnStatus = 'idle' | 'user_listening' | 'processing_speech' | 'assistant_speaking';
type ConversationStatus = 'idle' | 'active' | 'ended_by_user' | 'ended_by_limit';
type Message = { role: 'user' | 'assistant'; content: string; id: string };

interface ConversationContextType {
  conversationId: string | null;
  messages: Message[];
  conversationStatus: ConversationStatus;
  turnStatus: TurnStatus;
  startConversation: () => void;
  stopConversation: (reason?: ConversationStatus) => void;
  secondsRemaining: number;
  isPro: boolean;
  error: string | null;
}

const ConversationContext = createContext<ConversationContextType | undefined>(undefined);

export default function ConversationProvider({ children }: { children: React.ReactNode }) {
  const [session, setSession] = useState<Session | null>(null);
  const [isPro, setIsPro] = useState(false);
  const [freeSecondsRemaining, setFreeSecondsRemaining] = useState(FREE_TRIAL_LIMIT_SECONDS);

  const [conversationId, setConversationId] = useState<string | null>(null);
  const [messages, setMessages] = useState<Message[]>([]);
  const [conversationStatus, setConversationStatus] = useState<ConversationStatus>('idle');
  const [turnStatus, setTurnStatus] = useState<TurnStatus>('idle');
  const [error, setError] = useState<string | null>(null);

  const [proConversationTimer, setProConversationTimer] = useState(PRO_CONVERSATION_LIMIT_SECONDS);
  const proTimerIntervalRef = useRef<NodeJS.Timeout | null>(null);

  const mediaRecorderRef = useRef<MediaRecorder | null>(null);
  const audioChunksRef = useRef<Blob[]>([]);
  const audioPlayerRef = useRef<HTMLAudioElement | null>(null);

  useEffect(() => {
    const fetchProfile = async () => {
      const { data: { session } } = await supabase.auth.getSession();
      setSession(session);
      if (session) {
        const { data: profile } = await supabase.from('entitlements').select('status').eq('user_id', session.user.id).maybeSingle();
        const proStatus = profile?.status === 'active';
        setIsPro(proStatus);
  // sync free remaining with server once even for pro (not used when pro)
  const synced = await syncUsageWithServer().catch(() => null);
  if (synced) setFreeSecondsRemaining(synced.secondsRemaining);
      } else {
        setIsPro(false);
  // initialize guest usage
  const init = initializeUsage();
  setFreeSecondsRemaining(init.secondsRemaining);
      }
    };
    fetchProfile();
    const { data: authListener } = supabase.auth.onAuthStateChange((_event, session) => {
      setSession(session);
      fetchProfile();
    });
    return () => authListener.subscription.unsubscribe();
  }, []);

  // After returning from Stripe success, poll entitlements until active then scrub query param
  useEffect(() => {
    if (typeof window === 'undefined') return;
    if (!session) return;
    const url = new URL(window.location.href);
    if (url.searchParams.get('success') !== '1') return;
    let stopped = false;
    (async () => {
      for (let i = 0; i < 15 && !stopped; i++) {
        await new Promise(r => setTimeout(r, 2000));
        const { data: profile } = await supabase.from('entitlements').select('status').eq('user_id', session.user.id).maybeSingle();
        if (profile?.status === 'active') {
          setIsPro(true);
          window.dispatchEvent(new Event('entitlement:updated'));
          break;
        }
      }
      url.searchParams.delete('success');
      history.replaceState({}, '', url.toString());
    })();
    return () => { stopped = true; };
  }, [session]);

  useEffect(() => {
    if (conversationStatus === 'active' && isPro) {
      proTimerIntervalRef.current = setInterval(() => {
        setProConversationTimer(prev => {
          if (prev <= 1) {
            stopConversation('ended_by_limit');
            return 0;
          }
          return prev - 1;
        });
      }, 1000);
    } else {
      if (proTimerIntervalRef.current) clearInterval(proTimerIntervalRef.current);
    }
    return () => { if (proTimerIntervalRef.current) clearInterval(proTimerIntervalRef.current); };
  }, [conversationStatus, isPro]);

  const startConversation = useCallback(async () => {
    setError(null);
    // Gate on free minutes before starting
    if (!isPro && freeSecondsRemaining <= 0) {
      setConversationStatus('ended_by_limit');
      setTurnStatus('idle');
      setError('No time remaining today.');
      return;
    }
  // Ensure we have a session (anon or user) before recording
  await ensureAnonSession().catch(() => {});
    if (session) {
      const newConversation = await apiCreateConversation('New Conversation').catch(() => null);
      if (newConversation?.id) setConversationId(newConversation.id);
    }
    setMessages([]);
    setConversationStatus('active');
    setTurnStatus('user_listening');
    setProConversationTimer(PRO_CONVERSATION_LIMIT_SECONDS);
  }, [session, isPro, freeSecondsRemaining]);

  const stopConversation = useCallback((reason: ConversationStatus = 'ended_by_user') => {
    if (mediaRecorderRef.current?.state === 'recording') {
      mediaRecorderRef.current.stop();
    }
    mediaRecorderRef.current?.stream.getTracks().forEach(track => track.stop());
    mediaRecorderRef.current = null;
    if (audioPlayerRef.current) {
      audioPlayerRef.current.pause();
      audioPlayerRef.current = null;
    }
    setConversationStatus(reason);
    setTurnStatus('idle');
  }, []);

  const processAudioChunk = useCallback(async (audioBlob: Blob) => {
    setTurnStatus('processing_speech');

  const token = session?.access_token;

    const formData = new FormData();
    formData.append('audio', audioBlob, 'audio.webm');

    const url = new URL('/api/utterance', window.location.origin);
    if (conversationId) url.searchParams.set('conversationId', conversationId);

    try {
      const response = await fetch(url.toString(), {
        method: 'POST',
        headers: token ? { 'Authorization': `Bearer ${token}` } : {},
        body: formData,
      });

      if (response.status === 402) {
        setError('No time remaining today.');
        stopConversation('ended_by_limit');
        return;
      }

      if (!response.ok) throw new Error(`API Error: ${response.status} ${response.statusText}`);

      const result = await response.json();

      setMessages(prev => [
        ...prev,
        { role: 'user', content: result.transcript, id: crypto.randomUUID() },
        { role: 'assistant', content: result.reply, id: crypto.randomUUID() },
      ]);

      if (!isPro && typeof result.estSeconds === 'number' && result.estSeconds > 0) {
        const u = updateUsage(result.estSeconds);
        setFreeSecondsRemaining(u.secondsRemaining);
      }

      if (result.audioMp3Base64) {
        setTurnStatus('assistant_speaking');
        audioPlayerRef.current = await playMp3Base64(result.audioMp3Base64, () => {
          setTurnStatus('user_listening');
        });
      } else {
        setTurnStatus('user_listening');
      }
    } catch (e: any) {
      setError(e.message || 'An unknown error occurred.');
      stopConversation('ended_by_user');
    }
  }, [session, conversationId, isPro, stopConversation]);

  useEffect(() => {
    if (turnStatus === 'user_listening' && conversationStatus === 'active') {
      navigator.mediaDevices.getUserMedia({ audio: true })
        .then(stream => {
          mediaRecorderRef.current = new MediaRecorder(stream, { mimeType: 'audio/webm' });
          audioChunksRef.current = [];

          mediaRecorderRef.current.ondataavailable = event => {
            audioChunksRef.current.push(event.data);
          };

          mediaRecorderRef.current.onstop = () => {
            const audioBlob = new Blob(audioChunksRef.current, { type: 'audio/webm' });
            // close input stream
            try { mediaRecorderRef.current?.stream.getTracks().forEach(t => t.stop()); } catch {}
            if (audioBlob.size > 200) {
              processAudioChunk(audioBlob);
            }
          };

          mediaRecorderRef.current.start();

          const audioContext = new AudioContext();
          const source = audioContext.createMediaStreamSource(stream);
          const analyser = audioContext.createAnalyser();
          analyser.fftSize = 512;
          source.connect(analyser);
          const dataArray = new Uint8Array(analyser.frequencyBinCount);

          let silenceStart = performance.now();
          const checkSilence = () => {
            if (mediaRecorderRef.current?.state !== 'recording') return;
            analyser.getByteFrequencyData(dataArray);
            const sum = dataArray.reduce((acc, val) => acc + val, 0);
            if (sum < 50) {
              if (performance.now() - silenceStart > 2000) {
                mediaRecorderRef.current.stop();
              }
            } else {
              silenceStart = performance.now();
            }
            requestAnimationFrame(checkSilence);
          };
          checkSilence();
        })
        .catch(() => {
          setError('Microphone access was denied.');
          stopConversation('ended_by_user');
        });
    }
    return () => {
      if (mediaRecorderRef.current?.state === 'recording') {
        mediaRecorderRef.current.stop();
      }
    };
  }, [turnStatus, conversationStatus, processAudioChunk, stopConversation]);

  const value: ConversationContextType = {
    conversationId,
    messages,
    conversationStatus,
    turnStatus,
    startConversation,
    stopConversation,
  secondsRemaining: isPro ? proConversationTimer : freeSecondsRemaining,
    isPro,
    error,
  };

  return <ConversationContext.Provider value={value}>{children}</ConversationContext.Provider>;
}

export function useConversation() {
  const context = useContext(ConversationContext);
  if (context === undefined) {
    throw new Error('useConversation must be used within a ConversationProvider');
  }
  return context;
}
