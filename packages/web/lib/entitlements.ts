// lib/entitlements.ts (Supabase removed)
// Placeholder entitlement loader. Will later integrate with Prisma.
// Keeping the same exported shape to minimize cascading refactors.

// import { prisma } from './prisma'; // (future use)

export interface EntitlementsSnapshot {
  plan: 'free' | 'supporter';
  todaySecondsUsed: number;
  todaySecondsLimit: number; // 0 == unlimited
  chatSecondsElapsed: number;
  chatSecondsCap: number; // 7200 for pro, maybe same as daily for free
}

const FREE_DAILY_LIMIT = parseInt(process.env.DAILY_FREE_SECONDS_LIMIT || '300', 10);
const PRO_SESSION_LIMIT = parseInt(process.env.PRO_USER_CONVERSATION_SECONDS_LIMIT || '7200', 10);

export async function loadEntitlements(
  userId: string,
  chatSessionId: string,
): Promise<EntitlementsSnapshot> {
  // Placeholder: everyone is free, zero prior usage, no per-session elapsed tracking.
  // Future: derive plan & usage from Prisma tables (subscriptions, usage events, conversations).
  const plan: EntitlementsSnapshot['plan'] = 'free';
  const isPro = false; // plan === 'supporter'
  const todaySecondsUsed = 0;
  const chatSecondsElapsed = 0;
  return {
    plan,
    todaySecondsUsed,
    todaySecondsLimit: isPro ? 0 : FREE_DAILY_LIMIT,
    chatSecondsElapsed,
    chatSecondsCap: isPro ? PRO_SESSION_LIMIT : FREE_DAILY_LIMIT,
  };
}
