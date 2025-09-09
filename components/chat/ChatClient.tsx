'use client';
import { useEffect, useRef, useState } from 'react';
import VoiceOrb from '@/components/VoiceOrb';
import { voiceBus } from '@/lib/voiceBus';
import CallControls from '@/components/chat/CallControls';
import { useVoiceSocket } from '@/lib/hooks/useVoiceSocket';

export default function ChatClient({ persona }: { persona: string }) {
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const [conversationId, setConversationId] = useState<string | null>(null);

  // Setup socket (hybrid mode requires conversationId; we capture from server events)
  const { status, send } = useVoiceSocket({
    conversationId,
    onMessage: (msg: any) => {
      if (msg?.t === 'chat_session' && msg.chatSessionId) {
        setConversationId((prev) => prev || msg.chatSessionId);
      }
      if (msg?.type === 'audio_start') {
        // attach audio mime if needed
      }
      // handle other message types as necessary
    },
  });

  // Auto-start mic + connection once we have a conversation id (or request one by sending a ping)
  useEffect(() => {
    // If no conversation yet, request creation by sending a ping after small delay
    if (!conversationId && status === 'connected') {
      try { send({ type: 'ping' }); } catch {}
    }
  }, [conversationId, status, send]);

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

  // TODO: implement microphone capture + streaming (depends on existing audio pipeline)
  // Placeholder: could call startMic() from a hook once integrated.

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
