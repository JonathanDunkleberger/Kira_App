import { NextRequest, NextResponse } from 'next/server';
import { ensureUser } from '@/lib/auth';
import { FREE_TRIAL_SECONDS } from '@/lib/server/env.server';
import { recordUsageSeconds, getRemainingSeconds } from '@/lib/usage-prisma';

export const dynamic = 'force-dynamic';

// Guest/IP fallback removed: authenticated usage only for now.

export async function POST(req: NextRequest) {
  try {
    const user = await ensureUser();
    const body = await req.json().catch(() => ({}));
    const secondsUsed = Number(body?.secondsUsed || 0);
    if (user) {
      if (secondsUsed > 0) await recordUsageSeconds({ userId: user.id }, secondsUsed);
      const { remaining } = await getRemainingSeconds({ userId: user.id });
      return NextResponse.json(
        { secondsRemaining: remaining, dailyLimitSeconds: FREE_TRIAL_SECONDS, subject: 'user' },
        { headers: { 'Cache-Control': 'no-store, max-age=0' } },
      );
    }
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  } catch (e) {
    const error = e as Error;
    console.error('/api/usage POST Error:', error.message);
    return new NextResponse('Error updating usage', { status: 500 });
  }
}

// GET initializes and returns usage for the current subject.
// If authenticated, subject is the user. Otherwise, subject is anon:cid, where cid is persisted via cookie.
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
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  } catch (e) {
    const error = e as Error;
    console.error('/api/usage GET Error:', error.message);
    return new NextResponse('Error fetching usage', { status: 500 });
  }
}
