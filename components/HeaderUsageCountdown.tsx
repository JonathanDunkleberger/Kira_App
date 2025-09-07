'use client';
import { useEntitlement } from '@/lib/hooks/useEntitlement';
import { useConversation } from '@/lib/state/ConversationProvider';

const formatTime = (totalSeconds: number) => {
  const minutes = Math.floor(Math.max(0, totalSeconds) / 60);
  const seconds = Math.max(0, totalSeconds) % 60;
  return `${String(minutes).padStart(2, '0')}:${String(seconds).padStart(2, '0')}`;
};

export default function HeaderUsageCountdown() {
  const { isPro } = useConversation();
  const { secondsRemaining, isLoading } = useEntitlement();

  if (isPro || isLoading) return null;

  return (
    <div className="flex items-center gap-2 rounded-full border border-white/10 bg-white/5 px-3 py-1.5 text-sm">
      <span
        className={`h-2 w-2 rounded-full ${secondsRemaining > 0 ? 'bg-amber-400' : 'bg-red-500'}`}
      />
      <span className="font-medium text-white/90">Free Trial</span>
      <span className="text-white/60">{formatTime(secondsRemaining)}</span>
    </div>
  );
}
