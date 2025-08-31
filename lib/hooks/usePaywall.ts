'use client';

import { useState, useCallback, useEffect } from 'react';
import { useConversation } from '@/lib/state/ConversationProvider';
import { fetchEntitlement } from '@/lib/client-api';

export interface PaywallState {
  isOpen: boolean;
  secondsRemaining: number | null;
  isPro: boolean;
  isLoading: boolean;
  triggerPaywall: () => void;
  dismissPaywall: () => void;
  checkUsage: () => Promise<void>;
}

export function usePaywallBase(params: {
  session: any;
  contextIsPro: boolean;
  dailySecondsRemaining: number | null;
  promptPaywall: () => void;
  setShowPaywall: (open: boolean) => void;
}): PaywallState {
  const { session, contextIsPro, dailySecondsRemaining, promptPaywall, setShowPaywall } = params;
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
            setShowPaywall(true);
          }
        }
      } else {
        const today = new Date().toISOString().split('T')[0];
        const lastVisit = localStorage.getItem('kira_last_visit');
        const storedTime = localStorage.getItem('kira_guest_time');
        if (lastVisit === today && storedTime) {
          const time = parseInt(storedTime, 10);
          setSecondsRemaining(time);
          if (time <= 0) {
            setIsOpen(true);
            setShowPaywall(true);
          }
        } else {
          const FREE_TRIAL_SECONDS = 15 * 60; // fallback, real value fetched elsewhere
          localStorage.setItem('kira_last_visit', today);
          localStorage.setItem('kira_guest_time', FREE_TRIAL_SECONDS.toString());
          setSecondsRemaining(FREE_TRIAL_SECONDS);
        }
        setIsPro(false);
      }
    } catch (error) {
      console.error('Error checking usage:', error);
    } finally {
      setIsLoading(false);
    }
  }, [session, setShowPaywall]);

  const triggerPaywall = useCallback(() => {
    setIsOpen(true);
    setShowPaywall(true);
    // Also call provider's prompt for any side effects
    promptPaywall();
  }, [setShowPaywall, promptPaywall]);

  const dismissPaywall = useCallback(() => {
    setIsOpen(false);
    setShowPaywall(false);
  }, [setShowPaywall]);

  useEffect(() => { checkUsage(); }, [checkUsage]);

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
    checkUsage
  };
}

// Convenience hook for components: uses ConversationProvider context
export function usePaywall(): PaywallState {
  const { session, isPro: contextIsPro, dailySecondsRemaining, promptPaywall, setShowPaywall } = useConversation();
  return usePaywallBase({ session, contextIsPro, dailySecondsRemaining, promptPaywall, setShowPaywall });
}
