'use client';
import { useEffect, useRef } from 'react';

import ChatGuardrails from '../ChatGuardrails';
import VoiceOrb from '../VoiceOrb';
import { voiceBus } from '../../lib/voiceBus';
import { useVoiceSocket } from '../../lib/useVoiceSocket';

import CallControls from './CallControls';

export default function ChatClient({ persona }: { persona: string }) {
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const voice = useVoiceSocket();
  const started = useRef(false);

  useEffect(() => {
    if (started.current) return;
    started.current = true;
    (async () => {
      try {
        // Ensure an AudioContext can play (user gesture may be required)
        const AudioCtx: any = (window as any).AudioContext || (window as any).webkitAudioContext;
        let ctx: AudioContext | undefined;
        if (AudioCtx) {
          try {
            ctx = new AudioCtx();
            if (ctx?.state === 'suspended') await ctx.resume();
          } catch {}
        }
        await voice.connect({ persona });
        await voice.startMic();
        // Fallback: if first playback blocked, retry on next click
        const audio = document.getElementById('tts-audio') as HTMLAudioElement | null;
        if (audio) {
          audio.play().catch(() => {
            const once = () => {
              audio.play().finally(() => document.removeEventListener('click', once));
            };
            document.addEventListener('click', once, { once: true });
          });
        }
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
