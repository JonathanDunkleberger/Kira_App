'use client';

import { createContext, useContext, useState, useEffect, useRef, useCallback } from 'react';
import { supabase } from '@/lib/supabaseClient';
import { playMp3Base64 } from '@/lib/audio';
import { Session } from '@supabase/supabase-js';
import { createConversation as apiCreateConversation } from '@/lib/client-api';

const PRO_CONVERSATION_LIMIT_SECONDS = 20 * 60;

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
  micVolume: number;
  error: string | null;
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
  
  const [proConversationTimer, setProConversationTimer] = useState(PRO_CONVERSATION_LIMIT_SECONDS);
  const proTimerIntervalRef = useRef<NodeJS.Timeout | null>(null);
  const mediaRecorderRef = useRef<MediaRecorder | null>(null);
  const audioChunksRef = useRef<Blob[]>([]);
  const audioPlayerRef = useRef<HTMLAudioElement | null>(null);
  const vadCleanupRef = useRef<() => void>(() => {});

  useEffect(() => {
    const fetchProfile = async () => {
      const { data: { session } } = await supabase.auth.getSession();
      setSession(session);
      if (session) {
        const { data: profile } = await supabase.from('entitlements').select('status').eq('user_id', session.user.id).maybeSingle();
        setIsPro(profile?.status === 'active');
      } else { setIsPro(false); }
    };
    fetchProfile();
    const { data: authListener } = supabase.auth.onAuthStateChange((_event, session) => { setSession(session); fetchProfile(); });
    return () => authListener.subscription.unsubscribe();
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
    setError(null);
    // Guest vs logged-in conversation creation
    if (session) {
      try {
        const newConversation = await apiCreateConversation('New Conversation');
        setConversationId(newConversation.id);
      } catch (e: any) {
        setError(`Failed to create conversation: ${e.message}`);
        return;
      }
    } else {
      setConversationId(null);
    }
    setMessages([]);
    setConversationStatus('active');
    setTurnStatus('user_listening');
    setProConversationTimer(PRO_CONVERSATION_LIMIT_SECONDS);
  }, [session]);

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
    setTurnStatus('processing_speech');
    setMicVolume(0);
    
    const formData = new FormData();
    formData.append('audio', audioBlob, 'audio.webm');
    
    const url = new URL('/api/utterance', window.location.origin);
    if (conversationId) url.searchParams.set('conversationId', conversationId);
    
    try {
      const response = await fetch(url.toString(), {
        method: 'POST',
        headers: session?.access_token ? { 'Authorization': `Bearer ${session.access_token}` } : {},
        body: formData,
      });

      // Improved error handling
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

      const audioRes = await fetch('/api/synthesize', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ text: fullAssistantReply }) });
      if (audioRes.ok) {
        const { audioMp3Base64 } = await audioRes.json();
        if (audioMp3Base64) {
          audioPlayerRef.current = await playMp3Base64(audioMp3Base64, () => setTurnStatus('user_listening'));
        } else { setTurnStatus('user_listening'); }
      } else { console.error('Speech synthesis failed.'); setTurnStatus('user_listening'); }
      
    } catch (e: any) { setError(e.message); stopConversation('ended_by_user'); }
  }, [session, conversationId, stopConversation]);

  useEffect(() => {
    if (turnStatus === 'user_listening' && conversationStatus === 'active') {
      if (audioPlayerRef.current) { audioPlayerRef.current.pause(); audioPlayerRef.current = null; }
      
      navigator.mediaDevices.getUserMedia({ audio: true }).then(stream => {
        mediaRecorderRef.current = new MediaRecorder(stream, { mimeType: 'audio/webm' });
        audioChunksRef.current = [];
        mediaRecorderRef.current.ondataavailable = event => audioChunksRef.current.push(event.data);
        mediaRecorderRef.current.onstop = () => {
          const audioBlob = new Blob(audioChunksRef.current, { type: 'audio/webm' });
          if (audioBlob.size > 200) processAudioChunk(audioBlob);
        };
        mediaRecorderRef.current.start();

        const audioContext = new AudioContext();
        const source = audioContext.createMediaStreamSource(stream);
        const analyser = audioContext.createAnalyser();
        analyser.fftSize = 512;
        source.connect(analyser);
        const dataArray = new Uint8Array(analyser.frequencyBinCount);
        let silenceStart = performance.now();
        let animationFrameId: number;

        const checkSilence = () => {
          if (mediaRecorderRef.current?.state !== 'recording') { setMicVolume(0); return; }
          analyser.getByteFrequencyData(dataArray);
          const sum = dataArray.reduce((acc, val) => acc + val, 0);
          setMicVolume(sum / dataArray.length / 255);
          if (sum < 50) {
            if (performance.now() - silenceStart > 1500) mediaRecorderRef.current.stop();
          } else { silenceStart = performance.now(); }
          animationFrameId = requestAnimationFrame(checkSilence);
        };
        checkSilence();
        vadCleanupRef.current = () => { cancelAnimationFrame(animationFrameId); audioContext.close(); };
      }).catch(() => { setError('Microphone access was denied.'); stopConversation('ended_by_user'); });
    }
    return () => vadCleanupRef.current();
  }, [turnStatus, conversationStatus, processAudioChunk, stopConversation]);

  const value = { conversationId, messages, conversationStatus, turnStatus, startConversation, stopConversation, secondsRemaining: proConversationTimer, isPro, micVolume, error };
  return <ConversationContext.Provider value={value}>{children}</ConversationContext.Provider>;
}

export function useConversation() {
  const context = useContext(ConversationContext);
  if (context === undefined) throw new Error('useConversation must be used within a ConversationProvider');
  return context;
}
