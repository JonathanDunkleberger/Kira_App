'use client';

import { useState, useCallback, useEffect } from 'react';
import { useConversation } from '@/lib/state/ConversationProvider';
import { fetchEntitlement } from '@/lib/client-api';

export interface PaywallState {
  isOpen: boolean;
  secondsRemaining: number | null;
  isPro: boolean;
  isLoading: boolean;
  triggerPaywall: (source?: 'proactive_click' | 'time_exhausted') => void;
  dismissPaywall: () => void;
  checkUsage: () => Promise<void>;
}

export function usePaywallBase(params: {
  session: any;
  contextIsPro: boolean;
  dailySecondsRemaining: number | null;
  promptPaywall: (source: 'proactive_click' | 'time_exhausted') => void;
  closePaywall: () => void;
}): PaywallState {
  const { session, contextIsPro, dailySecondsRemaining, promptPaywall, closePaywall } = params;
  const [isOpen, setIsOpen] = useState(false);
  const [secondsRemaining, setSecondsRemaining] = useState<number | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [isPro, setIsPro] = useState(false);

  const checkUsage = useCallback(async () => {
    setIsLoading(true);
    try {
      if (session) {
        const ent = await fetchEntitlement();
        if (ent) {
          setIsPro(ent.status === 'active');
          setSecondsRemaining(ent.secondsRemaining);
          if (ent.secondsRemaining <= 0 && ent.status !== 'active') {
            setIsOpen(true);
            promptPaywall('time_exhausted');
          }
        }
      } else {
        // Guests: fetch unified session snapshot using guestId so server returns secondsRemaining
        try {
          const guestId =
            typeof window !== 'undefined'
              ? localStorage.getItem('kiraGuestId') ||
                localStorage.getItem('guestConversationId') ||
                localStorage.getItem('kira_guest_id') ||
                'guest'
              : 'guest';
          const url = new URL('/api/session', window.location.origin);
          url.searchParams.set('guestId', guestId);
          const res = await fetch(url.toString());
          if (res.ok) {
            const j = await res.json();
            const secs = Number(j?.secondsRemaining ?? 0);
            setSecondsRemaining(secs);
            setIsPro(false);
            if (secs <= 0) {
              setIsOpen(true);
              promptPaywall('time_exhausted');
            }
          } else {
            setSecondsRemaining(0);
            setIsPro(false);
          }
        } catch {
          setSecondsRemaining(0);
          setIsPro(false);
        }
      }
    } catch (error) {
      console.error('Error checking usage:', error);
    } finally {
      setIsLoading(false);
    }
  }, [session, promptPaywall]);

  const triggerPaywall = useCallback(
    (source: 'proactive_click' | 'time_exhausted' = 'proactive_click') => {
      setIsOpen(true);
      promptPaywall(source);
    },
    [promptPaywall],
  );

  const dismissPaywall = useCallback(() => {
    setIsOpen(false);
    closePaywall();
  }, [closePaywall]);

  useEffect(() => {
    checkUsage();
  }, [checkUsage]);

  useEffect(() => {
    setSecondsRemaining(dailySecondsRemaining);
    setIsPro(contextIsPro);
  }, [dailySecondsRemaining, contextIsPro]);

  return {
    isOpen,
    secondsRemaining,
    isPro,
    isLoading,
    triggerPaywall,
    dismissPaywall,
    checkUsage,
  };
}

// Convenience hook for components: uses ConversationProvider context
export function usePaywall(): PaywallState {
  const {
    session,
    isPro: contextIsPro,
    dailySecondsRemaining,
    promptPaywall,
    closePaywall,
  } = useConversation();
  return usePaywallBase({
    session,
    contextIsPro,
    dailySecondsRemaining,
    promptPaywall,
    closePaywall,
  });
}
