import { NextRequest, NextResponse } from 'next/server';
import { ensureUser } from '@/lib/auth';
import { FREE_TRIAL_SECONDS } from '@/lib/server/env.server';
import { getRemainingSeconds, recordUsageSeconds } from '@/lib/usage-prisma';

export const dynamic = 'force-dynamic';

function getClientIp(req: NextRequest): string | undefined {
  const forwarded = req.headers.get('x-forwarded-for');
  if (forwarded) {
    const first = forwarded.split(',')[0];
    if (first) {
      const ip = first.trim();
      if (ip) return ip;
    }
  }
  const realIp = req.headers.get('x-real-ip');
  if (realIp) return realIp;
  return undefined;
}

export async function POST(req: NextRequest) {
  try {
    const body = await req.json().catch(() => ({}));
    const secondsUsed = Number(body?.secondsUsed || 0);
    if (!Number.isFinite(secondsUsed) || secondsUsed < 0) {
      return NextResponse.json({ error: 'Invalid secondsUsed' }, { status: 400 });
    }
    const user = await ensureUser();
    if (user) {
      if (secondsUsed > 0) await recordUsageSeconds({ userId: user.id }, secondsUsed);
      const { remaining } = await getRemainingSeconds({ userId: user.id });
      return NextResponse.json(
        { secondsRemaining: remaining, dailyLimitSeconds: FREE_TRIAL_SECONDS, subject: 'user' },
        { headers: { 'Cache-Control': 'no-store, max-age=0' } },
      );
    }
    const ip = getClientIp(req);
    if (!ip) return NextResponse.json({ error: 'Unable to determine IP' }, { status: 400 });
    if (secondsUsed > 0) await recordUsageSeconds({ ip }, secondsUsed);
    const { remaining } = await getRemainingSeconds({ ip });
    return NextResponse.json(
      { secondsRemaining: remaining, dailyLimitSeconds: FREE_TRIAL_SECONDS, subject: 'ip' },
      { headers: { 'Cache-Control': 'no-store, max-age=0' } },
    );
  } catch (e) {
    const error = e as Error;
    console.error('/api/usage/update POST Error:', error.message);
    return new NextResponse('Error updating usage', { status: 500 });
  }
}
