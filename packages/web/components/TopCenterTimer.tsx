'use client';
import { useEffect, useMemo, useState } from 'react';

import { useUsage } from '@/lib/useUsage';

function fmt(s: number) {
  const m = Math.floor(s / 60),
    ss = s % 60;
  return `${m}:${String(ss).padStart(2, '0')}`;
}

export default function TopCenterTimer() {
  const { server, getDisplayTimes, setHeartbeat } = useUsage() as any;
  const [, tick] = useState(0);

  // Cosmetic tick every second so elapsed appears to advance between heartbeats
  useEffect(() => {
    const id = setInterval(() => tick((x) => x + 1), 1000);
    return () => clearInterval(id);
  }, []);

  // Self-hydrate on first mount if we don't yet have server state (supports resume, hard refresh)
  useEffect(() => {
    if (server) return;
    const params = new URLSearchParams(typeof window !== 'undefined' ? window.location.search : '');
    const chatSessionId = params.get('chatSessionId') ?? undefined;
    (async () => {
      try {
        const res = await fetch(
          `/api/entitlements${chatSessionId ? `?chatSessionId=${chatSessionId}` : ''}`,
          { cache: 'no-store' },
        );
        if (res.ok) {
          const state = await res.json();
          setHeartbeat({ t: 'heartbeat', now: Date.now(), entitlements: state });
        }
      } catch {}
    })();
  }, [server, setHeartbeat]);

  const elapsed = useMemo(() => {
    if (!server) return 0;
    const { todayUsed, chatElapsed } = getDisplayTimes();
    return server.todaySecondsLimit > 0 ? todayUsed : chatElapsed;
  }, [server, getDisplayTimes]);

  return (
    <div
      className="fixed left-1/2 top-[max(theme(space.2),env(safe-area-inset-top))] -translate-x-1/2 z-[100] pointer-events-none"
      aria-label="Session timer"
    >
      <div className="px-3 py-1 rounded-full border bg-white/80 backdrop-blur text-base font-medium shadow-sm">
        {fmt(elapsed)}
      </div>
    </div>
  );
}
