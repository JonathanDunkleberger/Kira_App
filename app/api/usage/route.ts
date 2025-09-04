import { NextResponse } from 'next/server';
import { checkUsage } from '@/lib/server/usage';
import { getSupabaseServerAdmin } from '@/lib/server/supabaseAdmin';
import { FREE_TRIAL_SECONDS } from '@/lib/server/env.server';

export const dynamic = 'force-dynamic';

export async function POST(req: Request) {
  try {
    const { guestId } = (await req.json()) as { guestId?: string };
    const supa = getSupabaseServerAdmin();
    const authHeader = req.headers.get('Authorization');
    const token = authHeader?.split('Bearer ')[1];
    let userId: string | null = null;
    
    if (token) {
      const { data: { user } } = await supa.auth.getUser(token);
      userId = user?.id || null;
    }

    const secondsRemaining = await checkUsage(userId, guestId || null);

    return NextResponse.json({ secondsRemaining, dailyLimitSeconds: FREE_TRIAL_SECONDS });
  } catch (e) {
    const error = e as Error;
    console.error('/api/usage Error:', error.message);
    return new NextResponse('Error fetching usage', { status: 500 });
  }
}
