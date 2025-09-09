'use client';
import { useEffect, useRef, useState, useRef as useMutableRef } from 'react';
import VoiceOrb from '@/components/VoiceOrb';
import { voiceBus } from '@/lib/voiceBus';
import CallControls from '@/components/chat/CallControls';
import { useVoiceSocket } from '@/lib/hooks/useVoiceSocket';

export default function ChatClient({ persona }: { persona: string }) {
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const [conversationId, setConversationId] = useState<string | null>(null);

  // Setup socket (hybrid mode requires conversationId; we capture from server events)
  const { connect, startMic, signal, status } = useVoiceSocket({
    conversationId,
    onMessage: (msg: any) => {
      if (msg?.t === 'chat_session' && msg.chatSessionId) {
        setConversationId((prev) => prev || msg.chatSessionId);
      }
    },
  });

  const startedRef = useRef(false);
  useEffect(() => {
    if (startedRef.current) return;
    startedRef.current = true;
    (async () => {
      try {
        await connect();
        await startMic();
        signal?.('client_ready');
      } catch (e) {
        console.error('Auto-start call failed', e);
      }
    })();
  }, [connect, startMic, signal]);

  useEffect(() => {
    const el = audioRef.current;
    if (!el) return;
    const onStart = () => voiceBus.emit('speaking', true);
    const onEnd = () => voiceBus.emit('speaking', false);
    el.addEventListener('play', onStart);
    el.addEventListener('playing', onStart);
    el.addEventListener('pause', onEnd);
    el.addEventListener('ended', onEnd);
    return () => {
      el.removeEventListener('play', onStart);
      el.removeEventListener('playing', onStart);
      el.removeEventListener('pause', onEnd);
      el.removeEventListener('ended', onEnd);
    };
  }, []);

  // microphone now auto-starts on mount

  return (
    <div className="min-h-[calc(100vh-3rem)] grid place-items-center">
      <audio ref={audioRef} className="hidden" id="tts-audio" />
      <div className="mt-10" />
      <VoiceOrb audioEl={audioRef.current} size={340} />
      <div className="mt-10" />
      <CallControls />
    </div>
  );
}
