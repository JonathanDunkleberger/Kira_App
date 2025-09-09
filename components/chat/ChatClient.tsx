'use client';
import { useEffect, useRef, useCallback, useState } from 'react';

import { Button } from '../ui/Button';
import ChatGuardrails from '../ChatGuardrails';
import VoiceOrb from '../VoiceOrb';
import { voiceBus } from '../../lib/voiceBus';
import {
  useVoiceSocket,
  connectVoice,
  startMic,
  endCall,
  sendJson,
  stopMicForUtterance,
} from '../../lib/useVoiceSocket';
import { useUsage } from '../../lib/useUsage';
import CallControls from './CallControls';

export default function ChatClient({ persona }: { persona: string }) {
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const voice = useVoiceSocket();
  const usage: any = useUsage();
  const [muted, setMuted] = useState(false);
  const [starting, setStarting] = useState(false);

  const startCall = useCallback(async () => {
    if (starting) return;
    setStarting(true);
    try {
      await connectVoice({
        persona,
        conversationId:
          usage.server?.chatSessionId ||
          (typeof window !== 'undefined'
            ? sessionStorage.getItem('kira_chat_session_id') || undefined
            : undefined),
      });
      await startMic();
      setMuted(false);
    } finally {
      setStarting(false);
    }
  }, [persona, usage, starting]);

  const endCallLocal = useCallback(() => {
    sendJson({ t: 'end' });
    usage.setChatSessionId(undefined);
    endCall();
  }, [usage]);

  // Auto-start if intent flag set
  useEffect(() => {
    if (typeof window === 'undefined') return;
    const flag = sessionStorage.getItem('kira_auto_start');
    if (flag === '1') {
      sessionStorage.removeItem('kira_auto_start');
      startCall();
    }
  }, [startCall]);

  // speaking events from audio element
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

  const toggleMute = useCallback(async () => {
    if (!voice.isConnected) return;
    if (muted) {
      await startMic();
      setMuted(false);
    } else {
      stopMicForUtterance();
      setMuted(true);
    }
  }, [muted, voice.isConnected]);

  return (
    <ChatGuardrails>
      <audio ref={audioRef} className="hidden" id="tts-audio" />
      <div className="mt-10" />
      <VoiceOrb audioEl={audioRef.current} size={280} />
      <div className="mt-6 flex justify-center gap-3">
        {!voice.isConnected && (
          <Button variant="primary" disabled={starting} onClick={startCall}>
            {starting ? 'Connecting…' : 'Start Call'}
          </Button>
        )}
        {voice.isConnected && (
          <>
            <Button variant="outline" onClick={toggleMute}>
              {muted ? 'Unmute' : 'Mute'}
            </Button>
            <Button variant="outline" onClick={endCallLocal}>
              End
            </Button>
          </>
        )}
      </div>
      <div className="mt-10" />
      <CallControls voice={voice} />
    </ChatGuardrails>
  );
}
