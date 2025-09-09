'use client';
import { useEffect, useRef } from 'react';
import VoiceOrb from '@/components/VoiceOrb';
import TopClockTimer from '@/components/TopClockTimer';
import { voiceBus } from '@/lib/voiceBus';

// If you already have a socket hook that manages conversation, integrate it here.
// import { useVoiceSocket } from '@/lib/hooks/useVoiceSocket';

export default function ChatClient({ chatSessionId }: { chatSessionId?: string }) {
  const audioRef = useRef<HTMLAudioElement | null>(null);

  // Bridge audio element events to the voice bus (in addition to amplitude detection)
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
    <>
      {/* Provide timer (layout already renders one globally; keep only if you want duplication) */}
      <TopClockTimer />

      <main className="min-h-[70vh] grid place-items-center px-4">
        <audio ref={audioRef} id="tts-audio" className="hidden" />
        <VoiceOrb audioEl={audioRef.current} size={320} />
        {/* TODO: Insert composer and messages list here using chatSessionId */}
      </main>
    </>
  );
}
