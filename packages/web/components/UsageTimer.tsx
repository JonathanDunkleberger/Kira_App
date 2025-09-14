'use client';
import { useEffect, useState } from 'react';

import { useConversation } from '../lib/state/ConversationProvider';

function format(secs: number) {
  if (secs < 0) secs = 0;
  const m = Math.floor(secs / 60);
  const s = Math.floor(secs % 60)
    .toString()
    .padStart(2, '0');
  return `${m}:${s}`;
}

/**
 * Simple replacement for legacy HeaderUsageIndicator / Countdown.
 * Reads dailySecondsRemaining + dailyLimitSeconds from ConversationProvider (fed by server headers soon)
 * and renders a compact pill. Hidden for Pro users.
 */
export default function UsageTimer() {
  const { isPro, dailySecondsRemaining, dailyLimitSeconds, promptPaywall } = useConversation();
  const [mounted, setMounted] = useState(false);
  useEffect(() => setMounted(true), []);
  if (!mounted) return null;
  if (isPro) return null;

  const pct = dailyLimitSeconds > 0 ? (dailySecondsRemaining / dailyLimitSeconds) * 100 : 0;
  const barColor = pct <= 10 ? 'bg-red-500' : pct <= 30 ? 'bg-yellow-500' : 'bg-fuchsia-500';

  return (
    <button
      onClick={() => promptPaywall?.('proactive_click')}
      className="flex items-center gap-2 rounded-full border border-white/10 bg-white/5 pl-3 pr-3 py-1.5 text-xs hover:bg-white/10 transition-colors w-44"
    >
      <div className="flex-1">
        <div className="flex justify-between text-[10px] text-white/60 mb-1">
          <span>Free Time</span>
          <span>{format(dailySecondsRemaining)}</span>
        </div>
        <div className="w-full h-1.5 bg-white/10 rounded-full overflow-hidden">
          <div className={`h-1.5 ${barColor}`} style={{ width: `${pct}%` }} />
        </div>
      </div>
    </button>
  );
}
