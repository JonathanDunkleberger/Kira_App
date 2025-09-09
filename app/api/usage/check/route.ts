import { NextRequest, NextResponse } from 'next/server';
import { ensureUser } from '@/lib/auth';
import { FREE_TRIAL_SECONDS } from '@/lib/server/env.server';
import { getRemainingSeconds } from '@/lib/usage-prisma';

export const dynamic = 'force-dynamic';

function getClientIp(req: NextRequest): string | undefined {
  // Respect common proxy headers (Vercel, etc.)
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
  // NextRequest doesn't expose remoteAddress directly in edge; leave undefined
  return undefined;
}

export async function GET(req: NextRequest) {
  try {
    const user = await ensureUser();
    if (user) {
      const { remaining } = await getRemainingSeconds({ userId: user.id });
      return NextResponse.json(
        { secondsRemaining: remaining, dailyLimitSeconds: FREE_TRIAL_SECONDS, subject: 'user' },
        { headers: { 'Cache-Control': 'no-store, max-age=0' } },
      );
    }
    const ip = getClientIp(req);
    if (!ip) {
      return NextResponse.json({ error: 'Unable to determine IP' }, { status: 400 });
    }
    const { remaining } = await getRemainingSeconds({ ip });
    return NextResponse.json(
      { secondsRemaining: remaining, dailyLimitSeconds: FREE_TRIAL_SECONDS, subject: 'ip' },
      { headers: { 'Cache-Control': 'no-store, max-age=0' } },
    );
  } catch (e) {
    const error = e as Error;
    console.error('/api/usage/check GET Error:', error.message);
    return new NextResponse('Error fetching usage', { status: 500 });
  }
}
