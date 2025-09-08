// components/TimerPill.tsx
'use client';
import { useEffect, useState } from 'react';
import { useUsage } from '@/lib/useUsage';

export default function TimerPill() {
  const { getDisplayTimes, server } = useUsage();
  const [, force] = useState(0);
  useEffect(() => {
    const id = setInterval(() => force((x) => x + 1), 1000);
    return () => clearInterval(id);
  }, []);
  if (!server) return null;
  const { todayUsed, chatElapsed } = getDisplayTimes();
  const fmt = (s: number) => `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
  const label = server.todaySecondsLimit > 0
    ? `Free time used ${fmt(todayUsed)} / ${fmt(server.todaySecondsLimit)}`
    : `This chat ${fmt(chatElapsed)} / ${fmt(server.chatSecondsCap)}`;
  return (
    <div className="mx-auto mt-2 rounded-full border border-white/15 px-3 py-1 text-xs sm:text-sm shadow-sm bg-white/10 backdrop-blur whitespace-nowrap">
      {label}
    </div>
  );
}