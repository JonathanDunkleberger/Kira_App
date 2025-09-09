'use client';
import { useEffect, useMemo, useState } from 'react';
import { useUsage } from '@/lib/useUsage';

// Optional: environment-driven branding
const NAME = process.env.NEXT_PUBLIC_AGENT_NAME ?? 'Kira';
const BYLINE = process.env.NEXT_PUBLIC_BYLINE ?? 'by elsa';

function fmt(s: number) {
  if (!Number.isFinite(s) || s < 0) s = 0;
  const m = Math.floor(s / 60);
  const ss = s % 60;
  return `${String(m).padStart(2, '0')}:${String(ss).padStart(2, '0')}`;
}

export default function TopClockTimer() {
  const { server, getDisplayTimes, setHeartbeat } = useUsage() as any;
  const [, force] = useState(0);

  // 1s cosmetic tick
  useEffect(() => {
    const id = setInterval(() => force((x) => x + 1), 1000);
    return () => clearInterval(id);
  }, []);

  // Self-hydrate if page loaded before first WS heartbeat (resume / hard refresh)
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
      } catch {
        /* ignore */
      }
    })();
  }, [server, setHeartbeat]);

  const elapsed = useMemo(() => {
    if (!server) return 0;
    const { todayUsed, chatElapsed } = getDisplayTimes();
    const v = server.todaySecondsLimit > 0 ? todayUsed : chatElapsed;
    return Number.isFinite(v) && v >= 0 ? v : 0;
  }, [server, getDisplayTimes]);

  return (
    <div
      className="fixed left-1/2 top-[max(theme(space.3),env(safe-area-inset-top))] -translate-x-1/2 z-[100] pointer-events-none text-center select-none"
      aria-label="Session timer"
    >
      <div className="text-[22px] sm:text-[24px] font-semibold tracking-tight text-[#566f2f]">
        {NAME} {fmt(elapsed)}
      </div>
      <div className="mt-1 text-xs sm:text-sm text-[#7a8b53]">{BYLINE}</div>
    </div>
  );
}
