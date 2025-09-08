// components/EntitlementsHydrator.tsx
'use client';
import { useEffect } from 'react';
import { useUsage } from '@/lib/useUsage';

export default function EntitlementsHydrator({ chatSessionId }: { chatSessionId?: string }) {
  useEffect(() => {
    let aborted = false;
    const run = async () => {
      try {
        const qs = chatSessionId ? `?chatSessionId=${chatSessionId}` : '';
        const res = await fetch(`/api/entitlements${qs}`, { cache: 'no-store' });
        if (!res.ok) return;
        const state = await res.json();
        if (aborted) return;
        useUsage.getState().setHeartbeat({ t: 'heartbeat', now: Date.now(), entitlements: state });
      } catch {}
    };
    run();
    return () => {
      aborted = true;
    };
  }, [chatSessionId]);
  return null;
}