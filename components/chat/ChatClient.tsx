'use client';
import { useEffect, useRef } from 'react';
import ChatGuardrails from '../ChatGuardrails';
import VoiceOrb from '../VoiceOrb';
import { voiceBus } from '../../lib/voiceBus';
import { connectVoice, startMic, setMuted } from '../../lib/voice';
import { useUsage } from '../../lib/useUsage';
import CallControls from './CallControls';

export default function ChatClient({ persona = 'kira' }: { persona?: string }) {
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const usage: any = useUsage();
  const once = useRef(false);

  useEffect(() => {
    if (once.current) return;
    once.current = true;
    (async () => {
      setMuted(false);
      await connectVoice({
        persona,
        conversationId:
          usage.server?.chatSessionId ??
          (typeof window !== 'undefined'
            ? sessionStorage.getItem('kira_chat_session_id') || undefined
            : undefined),
      });
      await startMic();
    })().catch(console.error);
  }, [persona, usage.server?.chatSessionId]);

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
    <ChatGuardrails>
      <audio ref={audioRef} className="hidden" id="tts-audio" />
      <div className="mt-10" />
      <VoiceOrb audioEl={audioRef.current} size={280} />
      <div className="mt-10" />
      <div className="fixed left-1/2 bottom-6 -translate-x-1/2">
        <CallControls />
      </div>
    </ChatGuardrails>
  );
}
