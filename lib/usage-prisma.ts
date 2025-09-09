import { prisma } from '@/lib/prisma';
import { FREE_TRIAL_SECONDS } from '@/lib/server/env.server';

function startOfUtcDay(d = new Date()) {
  return new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate(), 0, 0, 0, 0));
}

type Identity = { userId?: string; ip?: string };

function identityWhere(identity: Identity, start: Date, end: Date) {
  if (identity.userId) {
    return { userId: identity.userId, date: { gte: start, lt: end } };
  }
  if (identity.ip) {
    return { ip: identity.ip, date: { gte: start, lt: end } };
  }
  // Impossible in normal usage; return clause that matches nothing
  return { id: '__none__' };
}

export async function getDailyUsageSeconds(identity: Identity) {
  const start = startOfUtcDay();
  const end = new Date(start.getTime() + 24 * 60 * 60 * 1000);
  const agg = await prisma.usage.aggregate({
    _sum: { seconds: true },
    where: identityWhere(identity, start, end),
  });
  return agg._sum.seconds ?? 0;
}

export async function recordUsageSeconds(identity: Identity, seconds: number) {
  if (seconds <= 0) return;
  const data: { userId?: string; ip?: string; seconds: number } = {
    seconds: Math.ceil(seconds),
  };
  if (identity.userId) data.userId = identity.userId;
  else if (identity.ip) data.ip = identity.ip;
  await prisma.usage.create({ data });
}

export async function getRemainingSeconds(identity: Identity) {
  const used = await getDailyUsageSeconds(identity);
  const remaining = Math.max(0, FREE_TRIAL_SECONDS - used);
  return { used, remaining, limit: FREE_TRIAL_SECONDS };
}
