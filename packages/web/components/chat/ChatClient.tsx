// packages/web/components/chat/ChatClient.tsx
'use client';
import { useEffect, useState } from 'react';
import { Mic, PhoneOff } from 'lucide-react';
import { useRouter } from 'next/navigation';
import VoiceOrb from '../VoiceOrb';
import { useKiraSocket } from '../../lib/hooks/useKiraSocket';
import { PaywallModal } from './PaywallModal';

// Helper to format seconds into MM:SS format
const formatTime = (seconds: number) => {
  const mins = Math.floor(seconds / 60)
    .toString()
    .padStart(2, '0');
  const secs = (seconds % 60).toString().padStart(2, '0');
  return `${mins}:${secs}`;
};

const CallControls = ({ onEndCall }: { onEndCall: () => void }) => (
  <div className="flex items-center justify-center gap-4">
    <button className="flex h-14 w-14 cursor-not-allowed items-center justify-center rounded-full bg-neutral-500/20 text-white opacity-50">
      <Mic size={24} />
    </button>
    <button
      onClick={onEndCall}
      className="flex h-14 w-14 items-center justify-center rounded-full bg-red-500 text-white transition-colors hover:bg-red-600"
    >
      <PhoneOff size={24} />
    </button>
  </div>
);

export default function ChatClient({ conversationId }: { conversationId: string }) {
  const { status, startMic, stopMic, limitReachedReason } = useKiraSocket(conversationId);
  const router = useRouter();
  const [timer, setTimer] = useState(0);

  useEffect(() => {
    if (status === 'connected') {
      startMic();
      const audioEl = document.getElementById('tts-audio') as HTMLAudioElement;
      if (audioEl) {
        audioEl.muted = false;
        audioEl.play?.().catch(() => {});
      }
      // Start timer
      const interval = setInterval(() => {
        setTimer((prev) => prev + 1);
      }, 1000);
      return () => clearInterval(interval);
    }
    return () => stopMic();
  }, [status, startMic, stopMic]);

  const handleEndCall = () => {
    stopMic();
    // In the future, this will go to the feedback page. For now, it goes home.
    router.push('/');
  };

  const paywalled = !!limitReachedReason;

  return (
    <div className="relative flex min-h-screen w-full flex-col items-center justify-center">
      <audio id="tts-audio" className="hidden" autoPlay muted />

      <div className="absolute top-16 text-center">
        <h2 className="text-2xl font-medium">Kira</h2>
        <p className="text-lg text-neutral-500">{formatTime(timer)}</p>
      </div>

      <div className={paywalled ? 'pointer-events-none opacity-40 transition' : ''}>
        <VoiceOrb size={280} />
      </div>

      <div className="fixed bottom-16 left-1/2 -translate-x-1/2">
        <div className={paywalled ? 'pointer-events-none opacity-40' : ''}>
          <CallControls onEndCall={handleEndCall} />
        </div>
      </div>

      <PaywallModal
        reason={limitReachedReason}
        onUpgrade={() => {
          // Placeholder: integrate with subscription checkout
          window.location.href = '/billing';
        }}
        onClose={() => {
          // Allow user to dismiss but keep disabled state; optional: route home
        }}
        isPro={false}
      />
    </div>
  );
}
