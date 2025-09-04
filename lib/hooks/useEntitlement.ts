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
    const existing = localStorage.getItem(key)
      || localStorage.getItem('guestConversationId')
      || localStorage.getItem('kira_guest_id');
    if (existing) {
      try { localStorage.setItem(key, existing); } catch {}
      return existing;
    }
    const id = crypto.randomUUID();
    localStorage.setItem(key, id);
    return id;
  } catch {
    return 'guest';
  }
};

export function useEntitlement(): Entitlement & { refresh: () => Promise<void> } {
  const [entitlement, setEntitlement] = useState<Entitlement>({
    userStatus: 'guest',
  secondsRemaining: 0,
  dailyLimitSeconds: 0,
  trialPerDay: 0,
  proSessionLimit: 0,
    isLoading: true,
  });

  const fetchEnt = useCallback(async () => {
    // Debug: mark start of entitlement refresh
    try { console.log('[Entitlement] Refreshing usage...'); } catch {}
    try {
      const { data: { session } } = await supabase.auth.getSession();
      let res: Response;
      if (session?.access_token) {
        res = await fetch('/api/session', { headers: { Authorization: `Bearer ${session.access_token}` } });
      } else {
        const guestId = getGuestId();
        const url = new URL('/api/session', window.location.origin);
        url.searchParams.set('guestId', guestId);
        res = await fetch(url.toString());
  }
  if (!res.ok) {
        setEntitlement(prev => ({ ...prev, isLoading: false }));
        return;
      }
  const data = await res.json();
  // Debug: log new usage data received from server
  try { console.log('[Entitlement] New usage data received:', data); } catch {}
  const status = String(data?.status ?? 'inactive');
      const sessionPresent = !!(await supabase.auth.getSession()).data.session;
      const userStatus: 'guest' | 'free' | 'pro' = sessionPresent ? (status === 'active' ? 'pro' : 'free') : 'guest';
  const secondsRemaining = Number(data?.secondsRemaining ?? 0);
  const dailyLimitSeconds = Number(data?.dailyLimitSeconds ?? data?.trialPerDay ?? 0);
  const trialPerDay = Number(data?.trialPerDay ?? 0);
  const proSessionLimit = Number(data?.proSessionLimit ?? 0);
    setEntitlement({ userStatus, secondsRemaining, dailyLimitSeconds, trialPerDay, proSessionLimit, isLoading: false });
      try { localStorage.setItem('kira:secondsRemaining', String(secondsRemaining)); } catch {}
    } catch {
      setEntitlement(prev => ({ ...prev, isLoading: false }));
    }
  }, []);

  useEffect(() => {
    fetchEnt();
    const id = setInterval(fetchEnt, 5 * 60 * 1000);
    return () => clearInterval(id);
  }, [fetchEnt]);

  // Re-validate entitlement immediately on auth changes (login/logout/token refresh)
  useEffect(() => {
    const { data: sub } = supabase.auth.onAuthStateChange((event) => {
      if (event === 'SIGNED_IN' || event === 'SIGNED_OUT' || event === 'TOKEN_REFRESHED' || event === 'USER_UPDATED') {
        fetchEnt();
      }
    });
    return () => { sub?.subscription?.unsubscribe(); };
  }, [fetchEnt]);

  return { ...entitlement, refresh: fetchEnt };
}
