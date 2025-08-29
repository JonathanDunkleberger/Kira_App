'use client';

import { supabase } from '@/lib/supabaseClient';

export interface UsageState {
  secondsRemaining: number;
  lastReset: string; // ISO date string (YYYY-MM-DD)
  plan: 'free' | 'pro' | 'supporter';
  status: 'active' | 'inactive' | 'past_due' | 'canceled';
}

// Track usage in localStorage for all users
const USAGE_KEY = 'kira_usage';

export const initializeUsage = (): UsageState => {
  const today = new Date().toISOString().split('T')[0]; // YYYY-MM-DD
  const defaultState: UsageState = {
    secondsRemaining: 15 * 60, // 15 minutes in seconds
    lastReset: today,
    plan: 'free',
    status: 'inactive'
  };

  if (typeof window === 'undefined') return defaultState;

  try {
    const stored = localStorage.getItem(USAGE_KEY);
    if (stored) {
      const parsed = JSON.parse(stored);
      // Reset if it's a new day
      if (parsed.lastReset !== today) {
        const resetState = { ...defaultState, lastReset: today };
        localStorage.setItem(USAGE_KEY, JSON.stringify(resetState));
        return resetState;
      }
      return parsed as UsageState;
    }
    localStorage.setItem(USAGE_KEY, JSON.stringify(defaultState));
    return defaultState;
  } catch {
    return defaultState;
  }
};

export const updateUsage = (secondsUsed: number): UsageState => {
  if (typeof window === 'undefined') {
    return initializeUsage();
  }

  try {
    const current = initializeUsage();
    const newRemaining = Math.max(0, current.secondsRemaining - secondsUsed);
    const updatedState: UsageState = { ...current, secondsRemaining: newRemaining };

    localStorage.setItem(USAGE_KEY, JSON.stringify(updatedState));
    return updatedState;
  } catch {
    return initializeUsage();
  }
};

export const getUsageState = (): UsageState => {
  return initializeUsage();
};

// Sync with server when user is authenticated
export const syncUsageWithServer = async (): Promise<UsageState> => {
  const { data: { session } } = await supabase.auth.getSession();
  if (!session) return getUsageState();

  try {
    const response = await fetch('/api/usage', {
      headers: {
        Authorization: `Bearer ${session.access_token}`,
      },
      cache: 'no-store'
    });

    if (response.ok) {
      const serverUsage = await response.json();
      const mergedState = { ...getUsageState(), ...serverUsage } as UsageState;
      localStorage.setItem(USAGE_KEY, JSON.stringify(mergedState));
      return mergedState;
    }
  } catch (error) {
    console.error('Failed to sync usage with server:', error);
  }

  return getUsageState();
};
