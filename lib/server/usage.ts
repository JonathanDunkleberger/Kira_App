// In lib/server/usage.ts (shared by Next build)
import { envServer as env } from '@/lib/server/env.server';

// Returns seconds remaining for a signed-in user or a guest conversation
export async function checkUsage(userId: string | null, guestId: string | null): Promise<number> {
  const dailyLimit = parseInt(env.FREE_TRIAL_SECONDS, 10);

  // Logic for SIGNED-IN users
  if (userId) {
    try {
      // Placeholder: assume zero usage recorded.
      const secondsUsed = 0;
      return Math.max(0, dailyLimit - secondsUsed);
    } catch (e) {
      console.error('checkUsage for signed-in user failed:', e);
      return dailyLimit;
    }
  }

  // Logic for GUEST users
  if (guestId) {
    try {
      const secondsUsed = 0;
      return Math.max(0, dailyLimit - secondsUsed);
    } catch (e) {
      console.error('checkUsage for guest failed:', e);
      return dailyLimit;
    }
  }

  // If no one is identified, return the full limit
  return dailyLimit;
}

export async function deductUsage(conversationId: string, secondsUsed: number) {
  if (!conversationId || !secondsUsed) return;

  // Placeholder no-op.
  console.log('[Usage] (stub) deductUsage called', { conversationId, secondsUsed });
}
