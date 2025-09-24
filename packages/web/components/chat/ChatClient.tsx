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

const CallControls = ({
  onEndCall,
  isConnected,
}: {
  onEndCall: () => void;
  isConnected: boolean;
}) => (
  <div className="flex items-center justify-center gap-4">
    <button
      onClick={isConnected ? undefined : onEndCall}
      className={`flex h-14 w-14 items-center justify-center rounded-full ${
        isConnected ? 'bg-green-500' : 'bg-red-500'
      } text-white transition-colors hover:bg-red-600`}
    >
      {isConnected ? <Mic size={24} /> : <PhoneOff size={24} />}
    </button>
  </div>
);

export default function ChatClient({ conversationId }: { conversationId: string }) {
  const { status, startMic, stopMic, limitReachedReason, setLimitReachedReason, authError } =
    useKiraSocket(conversationId);
  const router = useRouter();
  const [timer, setTimer] = useState(0);

  useEffect(() => {
    let interval: ReturnType<typeof setInterval> | undefined;
    if (status === 'connected') {
      setTimeout(() => {
        startMic();
      }, 500);
      interval = setInterval(() => setTimer((prev) => prev + 1), 1000);
    } else if (status === 'disconnected') {
      stopMic();
    }
    return () => {
      if (interval) clearInterval(interval);
    };
  }, [status, startMic, stopMic]);

  const handleEndCall = () => {
    stopMic();
    // In the future, this will go to the feedback page. For now, it goes home.
    router.push('/');
  };

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
        <div className={paywalled ? 'pointer-events-none opacity-40' : ''}>
          <CallControls onEndCall={handleEndCall} isConnected={status === 'connected'} />
        </div>
      </div>

      <PaywallModal
        reason={limitReachedReason}
        onUpgrade={() => (window.location.href = '/account/billing')}
        onClose={() => setLimitReachedReason(null)}
        isPro={false}
      />
    </div>
  );
}
