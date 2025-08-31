import { NextRequest, NextResponse } from 'next/server';
import { getSupabaseServerAdmin } from '@/lib/supabaseAdmin';

export const runtime = 'nodejs';

export async function GET(req: NextRequest) {
  try {
    const sb = getSupabaseServerAdmin();
    const token = req.headers.get('authorization')?.replace('Bearer ', '');
    if (!token) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

    const { data: userData } = await sb.auth.getUser(token);
    const userId = (userData as any)?.user?.id as string | undefined;
    if (!userId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

    const { data: ent } = await sb
      .from('entitlements')
      .select('current_streak')
      .eq('user_id', userId)
      .maybeSingle();

    return NextResponse.json({ currentStreak: Number(ent?.current_streak ?? 0) });
  } catch (e: any) {
    return NextResponse.json({ error: e?.message || 'Server error' }, { status: 500 });
  }
}
