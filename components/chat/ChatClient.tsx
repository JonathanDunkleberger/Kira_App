'use client';
import { useEffect, useRef, useCallback } from 'react';

import ChatGuardrails from '../ChatGuardrails';
import VoiceOrb from '../VoiceOrb';
import { voiceBus } from '../../lib/voiceBus';
import { useVoiceSocket, connectVoice, startMic, endCall, sendJson } from '../../lib/useVoiceSocket';
import { useUsage } from '../../lib/useUsage';

import CallControls from './CallControls';

export default function ChatClient({ persona }: { persona: string }) {
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const voice = useVoiceSocket();
  const usage: any = useUsage();

  const startCall = useCallback(async () => {
    await connectVoice({
      persona,
      conversationId:
        usage.server?.chatSessionId ||
        (typeof window !== 'undefined'
          ? sessionStorage.getItem('kira_chat_session_id') || undefined
          : undefined),
    });
    await startMic();
  }, [persona, usage]);

  const endCallLocal = useCallback(() => {
    sendJson({ t: 'end' });
    usage.setChatSessionId(undefined);
    endCall();
  }, [usage]);

  // NOTE: call now starts only on user action (e.g., button outside) via startCall

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
