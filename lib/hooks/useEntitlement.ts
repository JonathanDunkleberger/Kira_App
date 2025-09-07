import { useCallback, useEffect, useState } from 'react';
import { supabase } from '@/lib/client/supabaseClient';

export type Entitlement = {
  userStatus: 'guest' | 'free' | 'pro';
  secondsRemaining: number;
  dailyLimitSeconds: number;
  trialPerDay: number;
  proSessionLimit: number;
  isLoading: boolean;
};

const getGuestId = (): string => {
  const key = 'kiraGuestId';
  try {
    if (typeof window === 'undefined') return 'guest';
    // Migrate from legacy keys if present
    const existing =
      localStorage.getItem(key) ||
      localStorage.getItem('guestConversationId') ||
      localStorage.getItem('kira_guest_id');
    if (existing) {
      try {
        localStorage.setItem(key, existing);
      } catch {}
      return existing;
    }
    const id = crypto.randomUUID();
    localStorage.setItem(key, id);
    return id;
  } catch {
    return 'guest';
  }
};

export function useEntitlement(): Entitlement & {
  refresh: () => Promise<void>;
  setSecondsRemaining: (seconds: number) => void;
} {
  const [entitlement, setEntitlement] = useState<Entitlement>({
    userStatus: 'guest',
    secondsRemaining: 0,
    dailyLimitSeconds: 0,
    trialPerDay: 0,
    proSessionLimit: 0,
    isLoading: true,
  });

  const fetchEnt = useCallback(async () => {
    console.log('[Entitlement] Refreshing usage...');
    try {
      const guestId = getGuestId();
      console.log('[Entitlement] Using guestId for refresh:', guestId);
      const res = await fetch('/api/usage', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ guestId }),
      });

      if (!res.ok) throw new Error('Failed to fetch usage');

      const data = await res.json();
      console.log('[Entitlement] New usage data received:', data);
      setEntitlement((prev) => ({ ...prev, ...data, isLoading: false }));
      try {
        localStorage.setItem('kira:secondsRemaining', String(data?.secondsRemaining ?? 0));
      } catch {}
    } catch (e) {
      console.error('Entitlement fetch failed', e);
      setEntitlement((prev) => ({ ...prev, isLoading: false }));
    }
  }, []);

  // Allow other parts of the app (e.g., WebSocket updates) to manually set remaining seconds
  const setSecondsRemaining = useCallback((seconds: number) => {
    console.log('[Entitlement] Manually setting seconds remaining:', seconds);
    setEntitlement((prev) => ({ ...prev, secondsRemaining: seconds, isLoading: false }));
    try {
      localStorage.setItem('kira:secondsRemaining', String(seconds ?? 0));
    } catch {}
    try {
      window.dispatchEvent(new Event('entitlement:updated'));
    } catch {}
  }, []);

  useEffect(() => {
    fetchEnt();
    const id = setInterval(fetchEnt, 5 * 60 * 1000);
    return () => clearInterval(id);
  }, [fetchEnt]);

  // Listen for WS-propagated seconds remaining updates
  useEffect(() => {
    const onWsUpdate = (e: Event) => {
      try {
        const custom = e as CustomEvent<number>;
        const secs = Number(custom.detail);
        if (Number.isFinite(secs)) setSecondsRemaining(secs);
      } catch {}
    };
    try {
      window.addEventListener('entitlement:update:secondsRemaining', onWsUpdate as any);
    } catch {}
    return () => {
      try {
        window.removeEventListener('entitlement:update:secondsRemaining', onWsUpdate as any);
      } catch {}
    };
  }, [setSecondsRemaining]);

  // Re-validate entitlement immediately on auth changes (login/logout/token refresh)
  useEffect(() => {
    const { data: sub } = supabase.auth.onAuthStateChange((event) => {
      if (
        event === 'SIGNED_IN' ||
        event === 'SIGNED_OUT' ||
        event === 'TOKEN_REFRESHED' ||
        event === 'USER_UPDATED'
      ) {
        fetchEnt();
      }
    });
    return () => {
      sub?.subscription?.unsubscribe();
    };
  }, [fetchEnt]);

  return { ...entitlement, refresh: fetchEnt, setSecondsRemaining };
}
