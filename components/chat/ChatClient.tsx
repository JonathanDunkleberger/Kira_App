'use client';
import { useEffect, useRef } from 'react';
import VoiceOrb from '@/components/VoiceOrb';
import { voiceBus } from '@/lib/voiceBus';
import CallControls from '@/components/chat/CallControls';

export default function ChatClient({ persona }: { persona: string }) {
  const audioRef = useRef<HTMLAudioElement | null>(null);

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
