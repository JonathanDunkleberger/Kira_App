// packages/web/components/chat/ChatClient.tsx
'use client';
import { useEffect, useState, useCallback } from 'react';
import { Mic, MicOff, PhoneOff } from 'lucide-react';
import { useRouter } from 'next/navigation';
import VoiceOrb from '../VoiceOrb';
import { useKiraSocket } from '../../lib/hooks/useKiraSocket';
import { PaywallModal } from './PaywallModal';

const formatTime = (seconds: number) => {
  const mins = Math.floor(seconds / 60)
    .toString()
    .padStart(2, '0');
  const secs = (seconds % 60).toString().padStart(2, '0');
  return `${mins}:${secs}`;
};

export default function ChatClient({ conversationId }: { conversationId: string }) {
  const { status, startMic, stopMic, limitReachedReason, authError } =
    useKiraSocket(conversationId);
  const router = useRouter();
  const [timer, setTimer] = useState(0);
  const [isMuted, setIsMuted] = useState(false);

  useEffect(() => {
    let interval: ReturnType<typeof setInterval> | undefined;
    if (status === 'connected') {
      startMic();
      interval = setInterval(() => setTimer((prev) => prev + 1), 1000);
    }
    return () => {
      if (interval) clearInterval(interval);
    };
  }, [status, startMic]);

  const handleEndCall = useCallback(() => {
    stopMic();
    router.push('/');
  }, [stopMic, router]);

  const handleToggleMute = useCallback(() => {
    setIsMuted((prev) => {
      const newMutedState = !prev;
      if (newMutedState) {
        stopMic();
      } else {
        startMic();
      }
      return newMutedState;
    });
  }, [startMic, stopMic]);

  const paywalled = !!limitReachedReason;

  return (
    <div className="relative flex min-h-screen w-full flex-col items-center justify-center p-4">
      <audio id="tts-audio" className="hidden" autoPlay />

      <div className="absolute top-16 text-center">
        <h2 className="text-2xl font-medium">Kira</h2>
        <p className="text-lg text-neutral-500">
          {status === 'connected' ? formatTime(timer) : status}
        </p>
        {authError && <p className="text-sm text-red-500 mt-2">{authError}</p>}
      </div>

      <div className={paywalled ? 'pointer-events-none opacity-40 transition' : ''}>
        <VoiceOrb size={280} />
      </div>

      <div className="fixed bottom-16 left-1/2 -translate-x-1/2">
        <div
          className={`flex items-center justify-center gap-4 ${paywalled ? 'pointer-events-none opacity-40' : ''}`}
        >
          <button
            onClick={handleToggleMute}
            className="flex h-14 w-14 items-center justify-center rounded-full bg-neutral-500/30 text-white transition-colors hover:bg-neutral-500/50"
          >
            {isMuted ? <MicOff size={24} /> : <Mic size={24} />}
          </button>
          <button
            onClick={handleEndCall}
            className="flex h-14 w-14 items-center justify-center rounded-full bg-red-500 text-white transition-colors hover:bg-red-600"
          >
            <PhoneOff size={24} />
          </button>
        </div>
      </div>

      <PaywallModal reason={limitReachedReason} onClose={handleEndCall} isPro={false} />
    </div>
  );
}
