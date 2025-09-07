import { NextRequest, NextResponse } from 'next/server';

import { getSupabaseServerAdmin } from '@/lib/server/supabaseAdmin';

export const runtime = 'nodejs';

export async function POST(req: NextRequest) {
  try {
    const sb = getSupabaseServerAdmin();
    const token = req.headers.get('authorization')?.replace('Bearer ', '');
    if (!token) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

    const { data, error } = await sb.auth.getUser(token);
    if (error || !data?.user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

    const userId = data.user.id;
    const { error: delErr } = await sb.auth.admin.deleteUser(userId);
    if (delErr) return NextResponse.json({ error: delErr.message }, { status: 500 });

    return NextResponse.json({ ok: true });
  } catch (e: any) {
    return NextResponse.json({ error: e?.message || 'Server error' }, { status: 500 });
  }
}
