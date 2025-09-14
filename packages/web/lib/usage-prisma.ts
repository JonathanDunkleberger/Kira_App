import { prisma } from '@/lib/prisma';
import { FREE_TRIAL_SECONDS } from '@/lib/server/env.server';

function startOfUtcDay(d = new Date()) {
  return new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate(), 0, 0, 0, 0));
}

type Identity = { userId?: string };

export async function getDailyUsageSeconds(identity: Identity) {
  if (!identity.userId) return 0; // guest flow deferred
  const start = startOfUtcDay();
  // @ts-ignore prisma client may expose as dailyUsage based on model name
  const row = await prisma.dailyUsage.findFirst({ where: { userId: identity.userId, day: start } });
  return row?.seconds ?? 0;
}

export async function recordUsageSeconds(identity: Identity, seconds: number) {
  if (!identity.userId) return; // skip guest for now
  if (seconds <= 0) return;
  const start = startOfUtcDay();
  // @ts-ignore
  await prisma.dailyUsage.upsert({
    where: { userId_day: { userId: identity.userId, day: start } },
    create: { userId: identity.userId, day: start, seconds: Math.ceil(seconds) },
    update: { seconds: { increment: Math.ceil(seconds) } },
  });
}

export async function getRemainingSeconds(identity: Identity) {
  const used = await getDailyUsageSeconds(identity);
  const remaining = Math.max(0, FREE_TRIAL_SECONDS - used);
  return { used, remaining, limit: FREE_TRIAL_SECONDS };
}
