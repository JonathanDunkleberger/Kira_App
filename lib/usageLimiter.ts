// lib/usageLimiter.ts (Supabase removed)
// Lightweight in-memory / stateless usage limiter placeholder.
// TODO: Replace with Prisma persistence or Redis rate limiting.

export interface UsageResult {
  used: number;
  remaining: number;
  limit: number;
  isPro: boolean;
  hasReachedLimit: boolean;
}

function dailyLimit(): number {
  return parseInt(process.env.DAILY_FREE_SECONDS_LIMIT || '300', 10);
}
function proLimit(): number {
  return parseInt(process.env.PRO_USER_CONVERSATION_SECONDS_LIMIT || '7200', 10);
}

function isResetNeeded(last: string | null | undefined): boolean {
  if (!last) return true;
  const t = Date.parse(last);
  if (!Number.isFinite(t)) return true;
  return Date.now() - t > 24 * 60 * 60 * 1000;
}

export async function getCurrentUsage(userId: string | null): Promise<UsageResult> {
  // Without persistence we assume zero prior usage for authenticated users.
  if (!userId) {
    return { used: 0, remaining: dailyLimit(), limit: dailyLimit(), isPro: false, hasReachedLimit: false };
  }
  const isPro = false; // Placeholder; integrate with subscription system later.
  const limit = isPro ? proLimit() : dailyLimit();
  return { used: 0, remaining: limit, limit, isPro, hasReachedLimit: false };
}

export async function checkAndIncrementUsage(
  userId: string,
  durationSeconds: number,
): Promise<UsageResult> {
  // Stateless placeholder: always returns initial limit (no accumulation tracked).
  return getCurrentUsage(userId);
}
