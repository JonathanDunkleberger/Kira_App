import { useCallback, useEffect, useState } from 'react';
import { supabase } from '@/lib/supabaseClient';

export type Entitlement = {
  userStatus: 'guest' | 'free' | 'pro';
  secondsRemaining: number;
  trialPerDay: number;
  proSessionLimit: number;
  isLoading: boolean;
};

const getGuestId = (): string => {
  // Prefer an existing guest conversation id if present
  try {
    const convId = typeof window !== 'undefined'
      ? (sessionStorage.getItem('guestConversationId') || localStorage.getItem('guestConversationId'))
      : null;
    if (convId) return convId;
  } catch {}
  const key = 'kira_guest_id';
  try {
    const existing = localStorage.getItem(key);
    if (existing) return existing;
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
  trialPerDay: 0,
  proSessionLimit: 0,
    isLoading: true,
  });

  const fetchEnt = useCallback(async () => {
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
  const status = String(data?.status ?? 'inactive');
      const sessionPresent = !!(await supabase.auth.getSession()).data.session;
      const userStatus: 'guest' | 'free' | 'pro' = sessionPresent ? (status === 'active' ? 'pro' : 'free') : 'guest';
  const secondsRemaining = Number(data?.secondsRemaining ?? 0);
  const trialPerDay = Number(data?.trialPerDay ?? 0);
  const proSessionLimit = Number(data?.proSessionLimit ?? 0);
      setEntitlement({ userStatus, secondsRemaining, trialPerDay, proSessionLimit, isLoading: false });
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
