import { NextRequest, NextResponse } from 'next/server';
import { ensureUser } from '@/lib/auth';
import { FREE_TRIAL_SECONDS } from '@/lib/server/env.server';
import { getRemainingSeconds } from '@/lib/usage-prisma';

export const dynamic = 'force-dynamic';

// IP logic removed.

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
    console.error('/api/usage/check GET Error:', error.message);
    return new NextResponse('Error fetching usage', { status: 500 });
  }
}
