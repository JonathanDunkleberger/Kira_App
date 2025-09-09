'use client';
import { useEffect, useState } from 'react';

import { useUsage } from '@/lib/useUsage';

function fmt(s: number) {
  const m = Math.floor(s / 60);
  const ss = s % 60;
  return `${m}:${String(ss).padStart(2, '0')}`;
}

export default function TopCenterTimer() {
  const { server, getDisplayTimes } = useUsage();
  const [, tick] = useState(0);

  useEffect(() => {
    const id = setInterval(() => tick((x) => x + 1), 1000);
    return () => clearInterval(id);
  }, []);

  if (!server) return null;
  const { todayUsed, chatElapsed } = getDisplayTimes();
  const elapsed = server.todaySecondsLimit > 0 ? todayUsed : chatElapsed;

  return (
    <div
      className="fixed left-1/2 top-2 -translate-x-1/2 z-50 pointer-events-none"
      aria-label="Session timer"
    >
      <div className="px-3 py-1 rounded-full border bg-white/80 backdrop-blur text-base font-medium shadow-sm text-black">
        {fmt(elapsed)}
      </div>
    </div>
  );
}
