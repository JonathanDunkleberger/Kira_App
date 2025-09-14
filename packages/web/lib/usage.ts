import { FREE_TRIAL_SECONDS } from '@/lib/server/env.server';

/**
 * Ensure a row exists and daily counters are initialized.
 * FREE_TRIAL_SECONDS now means "per day".
 */
export async function ensureEntitlements(userId: string, perDay: number = FREE_TRIAL_SECONDS) {
  // Placeholder no-op; Supabase removed. Future: implement via Prisma.
  return;
}

export async function getEntitlement(userId: string) {
  // Static placeholder response until Prisma entitlements added.
  const data: any = null;
  return {
    status: (data?.status ?? 'inactive') as 'inactive' | 'active' | 'past_due' | 'canceled',
    plan: (data?.plan ?? 'free') as 'free' | 'supporter',
    trial_seconds_remaining: data?.trial_seconds_remaining ?? 0,
    trial_last_reset: data?.trial_last_reset ?? new Date().toISOString().slice(0, 10),
    trial_seconds_per_day: data?.trial_seconds_per_day ?? FREE_TRIAL_SECONDS,
  };
}

/** Remaining daily seconds (after ensuring reset). */
export async function getDailySecondsRemaining(userId: string): Promise<number> {
  await ensureEntitlements(userId, FREE_TRIAL_SECONDS);
  const ent = await getEntitlement(userId);
  return ent.trial_seconds_remaining;
}

// Transition helper: messages-based quota reads the same field until DB is migrated.
export async function getDailyMessagesRemaining(userId: string): Promise<number> {
  return getDailySecondsRemaining(userId);
}

/**
 * Decrement daily seconds based on calculated duration.
 * Returns the updated remaining seconds (undefined for Pro users).
 */
export async function decrementDailySeconds(
  userId: string,
  secondsUsed: number,
): Promise<number | undefined> {
  // Placeholder: no persistence. Returns decremented simulated value only.
  const ent = await getEntitlement(userId);
  if (ent.status === 'active') return;
  const currentRemaining = ent.trial_seconds_remaining ?? FREE_TRIAL_SECONDS;
  const newRemaining = Math.max(0, currentRemaining - secondsUsed);
  return newRemaining;
}

// Temporary shim during migration to messages-based quotas
export async function decrementDailyMessages(userId: string): Promise<number | undefined> {
  // Hardcoded decrement by 1 message; we treat each message ~ fixed unit and map to secondsUsed = 1
  return decrementDailySeconds(userId, 1);
}

/** Keep your existing Pro-grant semantics. */
export async function setPro(
  userId: string,
  opts?: {
    stripeCustomerId?: string;
    stripeSubscriptionId?: string;
    status?: 'active' | 'past_due' | 'canceled';
  },
) {
  // Placeholder: would mark user as pro in future Prisma table.
  return;
}
