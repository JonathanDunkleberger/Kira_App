'use client';
import { useEffect, useRef } from 'react';
import VoiceOrb from '@/components/VoiceOrb';
import { voiceBus } from '@/lib/voiceBus';
import CallControls from '@/components/chat/CallControls';
import { useVoiceSocket } from '@/lib/useVoiceSocket';
import ChatGuardrails from '@/components/ChatGuardrails';

export default function ChatClient({ persona }: { persona: string }) {
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const voice = useVoiceSocket();
  const started = useRef(false);

  useEffect(() => {
    if (started.current) return;
    started.current = true;
    (async () => {
      try {
        await voice.connect({ persona });
        await voice.startMic();
        voice.signal?.('client_ready');
      } catch (e) {
        console.error('start failed', e);
      }
    })();
  }, [voice, persona]);

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
    <ChatGuardrails>
      <audio ref={audioRef} className="hidden" id="tts-audio" />
      <div className="mt-10" />
      <VoiceOrb audioEl={audioRef.current} size={280} />
      <div className="mt-10" />
      <CallControls voice={voice} />
    </ChatGuardrails>
  );
}
