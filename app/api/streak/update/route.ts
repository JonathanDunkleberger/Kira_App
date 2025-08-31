import { NextRequest, NextResponse } from 'next/server';
import { getSupabaseServerAdmin } from '@/lib/supabaseAdmin';

export const runtime = 'nodejs';

function todayUtc(): string {
  return new Date().toISOString().slice(0, 10);
}
function yesterdayUtc(): string {
  const d = new Date();
  d.setUTCDate(d.getUTCDate() - 1);
  return d.toISOString().slice(0, 10);
}

export async function POST(req: NextRequest) {
  try {
    const sb = getSupabaseServerAdmin();
    const token = req.headers.get('authorization')?.replace('Bearer ', '');
    if (!token) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

    const { data: userData } = await sb.auth.getUser(token);
    const userId = (userData as any)?.user?.id as string | undefined;
    if (!userId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

    const { data: ent } = await sb
      .from('entitlements')
      .select('current_streak, last_streak_date')
      .eq('user_id', userId)
      .maybeSingle();

    const today = todayUtc();
    const yest = yesterdayUtc();
    const current = Number(ent?.current_streak ?? 0);
    const last = ent?.last_streak_date as string | null;

    let nextStreak = current;
    let nextDate = last ?? null;

    if (last === today) {
      // already counted today
      return NextResponse.json({ currentStreak: current });
    }
    if (last === yest) {
      nextStreak = current + 1;
    } else {
      // start streak at 1 for today
      nextStreak = 1;
    }
    nextDate = today;

    await sb
      .from('entitlements')
      .update({ current_streak: nextStreak, last_streak_date: nextDate })
      .eq('user_id', userId);

  return NextResponse.json({ currentStreak: nextStreak, streak: nextStreak });
  } catch (e: any) {
    return NextResponse.json({ error: e?.message || 'Server error' }, { status: 500 });
  }
}
