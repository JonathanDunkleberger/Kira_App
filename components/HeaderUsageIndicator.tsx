'use client';

import { useConversation } from '@/lib/state/ConversationProvider';

const formatTime = (seconds: number) => {
  if (seconds < 0) seconds = 0;
  const mins = Math.floor(seconds / 60);
  const secs = Math.floor(seconds % 60);
  return `${mins}:${secs.toString().padStart(2, '0')}`;
};

export default function HeaderUsageIndicator() {
  const { isPro, dailySecondsRemaining, dailyLimitSeconds, promptPaywall } = useConversation();

  // Show nothing if the user is Pro
  if (isPro) {
    return null;
  }
  
  const totalSeconds = dailyLimitSeconds > 0 ? dailyLimitSeconds : 1; // Avoid division by zero
  const percentage = (dailySecondsRemaining / totalSeconds) * 100;

  // Change color based on time remaining
  const progressBarColor = 
    percentage <= 10 ? 'bg-red-500' : 
    percentage <= 30 ? 'bg-yellow-500' : 
    'bg-fuchsia-500';

  return (
    <button 
      onClick={() => promptPaywall?.('proactive_click')}
      className="flex items-center gap-3 rounded-full border border-white/10 bg-white/5 px-3 py-1.5 text-sm w-48 text-left hover:bg-white/10 transition-colors"
    >
      <div className="flex-1 space-y-1">
        <div className="flex justify-between items-center text-xs text-white/70">
          <span>Free Minutes</span>
          <span>{formatTime(dailySecondsRemaining)}</span>
        </div>
        <div className="w-full bg-white/10 rounded-full h-1.5">
          <div 
            className={`h-1.5 rounded-full ${progressBarColor} transition-all duration-300`} 
            style={{ width: `${percentage}%` }}
          />
        </div>
      </div>
    </button>
  );
}
