import { NextRequest, NextResponse } from 'next/server';

import { getSupabaseServerAdmin } from '@/lib/server/supabaseAdmin';

export const runtime = 'nodejs';

export async function GET(req: NextRequest) {
  try {
    const sb = getSupabaseServerAdmin();
    const token = req.headers.get('authorization')?.replace('Bearer ', '');
    if (!token) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    const { data: userData } = await sb.auth.getUser(token);
    const userId = (userData as any)?.user?.id as string | undefined;
    if (!userId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

    const { data, error } = await sb
      .from('user_achievements')
      .select('achievement_id')
      .eq('user_id', userId);
    if (error) throw error;

    const ids = (data || []).map((r: any) => r.achievement_id);
    return NextResponse.json({ ids });
  } catch (e: any) {
    return NextResponse.json({ error: e?.message || 'Server error' }, { status: 500 });
  }
}

export async function POST(req: NextRequest) {
  try {
    const sb = getSupabaseServerAdmin();
    const token = req.headers.get('authorization')?.replace('Bearer ', '');
    if (!token) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    const { data: userData } = await sb.auth.getUser(token);
    const userId = (userData as any)?.user?.id as string | undefined;
    if (!userId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

    const { ids } = await req.json();
    if (!Array.isArray(ids) || !ids.length) return NextResponse.json({ ok: true });

    const rows = ids.map((id: string) => ({ user_id: userId, achievement_id: id }));
    // idempotent insert
    const { error } = await sb
      .from('user_achievements')
      .upsert(rows, { onConflict: 'user_id,achievement_id', ignoreDuplicates: true });
    if (error) throw error;

    return NextResponse.json({ ok: true });
  } catch (e: any) {
    return NextResponse.json({ error: e?.message || 'Server error' }, { status: 500 });
  }
}
