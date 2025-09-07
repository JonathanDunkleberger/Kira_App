import { NextRequest, NextResponse } from 'next/server';

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
      const {
        data: { user },
      } = await supa.auth.getUser(token);
      userId = user?.id || null;
    }

    const secondsRemaining = await checkUsage(userId, guestId || null);

    return NextResponse.json(
      { secondsRemaining, dailyLimitSeconds: FREE_TRIAL_SECONDS },
      { headers: { 'Cache-Control': 'no-store, max-age=0' } },
    );
  } catch (e) {
    const error = e as Error;
    console.error('/api/usage Error:', error.message);
    return new NextResponse('Error fetching usage', { status: 500 });
  }
}

// GET initializes and returns usage for the current subject.
// If authenticated, subject is the user. Otherwise, subject is anon:cid, where cid is persisted via cookie.
export async function GET(req: NextRequest) {
  try {
    const supa = getSupabaseServerAdmin();
    const authHeader = req.headers.get('Authorization');
    const token = authHeader?.split('Bearer ')[1];
    let userId: string | null = null;
    if (token) {
      const {
        data: { user },
      } = await supa.auth.getUser(token);
      userId = user?.id || null;
    }

    // For guests, manage a kira_cid cookie
    let cid = req.cookies.get('kira_cid')?.value || '';
    const url = new URL(req.url);
    const conversationId = url.searchParams.get('conversationId') || '';
    if (!userId) {
      if (!cid) {
        // Generate a new cid
        cid = `${Date.now()}-${Math.random().toString(36).slice(2)}`;
      }
    }

    // If guest with a conversationId, prefer conversation seconds_remaining
    if (!userId && conversationId) {
      const { data: conv, error } = await supa
        .from('conversations')
        .select('seconds_remaining')
        .eq('id', conversationId)
        .maybeSingle();
      if (error) throw error;
      const secondsRemaining = Number(conv?.seconds_remaining ?? FREE_TRIAL_SECONDS);
      const res = NextResponse.json(
        { secondsRemaining, dailyLimitSeconds: FREE_TRIAL_SECONDS },
        { headers: { 'Cache-Control': 'no-store, max-age=0' } },
      );
      if (cid)
        res.cookies.set('kira_cid', cid, { maxAge: 60 * 60 * 24 * 30, path: '/', sameSite: 'lax' });
      return res;
    }

    // Otherwise, compute usage via existing helper (user or anon subject via cid)
    const secondsRemaining = await checkUsage(userId, userId ? null : cid || null);

    const res = NextResponse.json(
      { secondsRemaining, dailyLimitSeconds: FREE_TRIAL_SECONDS },
      { headers: { 'Cache-Control': 'no-store, max-age=0' } },
    );
    // Set cookie if we're treating this as a guest
    if (!userId && cid) {
      // 30 days, lax, httpOnly false so client JS can also read if needed
      res.cookies.set('kira_cid', cid, { maxAge: 60 * 60 * 24 * 30, path: '/', sameSite: 'lax' });
    }
    return res;
  } catch (e) {
    const error = e as Error;
    console.error('/api/usage GET Error:', error.message);
    return new NextResponse('Error fetching usage', { status: 500 });
  }
}
