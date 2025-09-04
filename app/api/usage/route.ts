import { NextResponse } from 'next/server';
import { checkUsage } from '@/lib/server/usage';
import { getSupabaseServerAdmin } from '@/lib/server/supabaseAdmin';
import { FREE_TRIAL_SECONDS } from '@/lib/server/env.server';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function POST(req: Request) {
  try {
    const { guestId } = (await req.json()) as { guestId?: string };

    const sb = getSupabaseServerAdmin();
    const auth = req.headers.get('authorization') || '';
    const token = auth.startsWith('Bearer ') ? auth.slice(7) : null;
    let userId: string | null = null;
    if (token) {
      const { data } = await sb.auth.getUser(token);
      userId = data?.user?.id ?? null;
    }

  const secondsRemaining = await checkUsage(userId, guestId ?? null);
  return NextResponse.json({ secondsRemaining, dailyLimitSeconds: FREE_TRIAL_SECONDS });
  } catch (e) {
    return new NextResponse('Error fetching usage', { status: 500 });
  }
}
