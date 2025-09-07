'use client';
import { useEffect } from 'react';
import { useConversation } from '@/lib/state/ConversationProvider';

export default function UsageBadge() {
  const { usageRemaining, refreshUsage, connectionStatus, turnStatus } = useConversation();

  // Auto-refresh every 60s when idle
  useEffect(() => {
    const id = setInterval(() => {
      Promise.resolve(refreshUsage()).catch(() => {});
    }, 60000);
    return () => clearInterval(id);
  }, [refreshUsage]);

  const secs = usageRemaining ?? 0;
  const minutes = Math.floor(secs / 60);
  const seconds = secs % 60;
  const countdown = `${minutes}:${String(seconds).padStart(2, '0')}`;

  const connColor =
    connectionStatus === 'connected'
      ? 'bg-emerald-500'
      : connectionStatus === 'connecting'
        ? 'bg-amber-400'
        : 'bg-red-500';
  const turnText = turnStatus === 'idle' ? 'idle' : turnStatus;

  return (
    <div className="flex items-center gap-3 text-sm">
      <span
        className={`inline-flex items-center gap-1 px-2 py-1 rounded-full bg-white/5 border border-white/10`}
      >
        <span className={`h-2 w-2 rounded-full ${connColor}`} />
        <span className="text-white/80">{turnText}</span>
      </span>
      <button
        onClick={() => {
          void Promise.resolve(refreshUsage());
        }}
        className="inline-flex items-center gap-1 px-2 py-1 rounded-full bg-white/5 border border-white/10 hover:bg-white/10"
        title="Refresh remaining time"
      >
        <span className="text-white/60">remaining</span>
        <span className="font-semibold">{countdown}</span>
      </button>
    </div>
  );
}
