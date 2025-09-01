import { NextRequest, NextResponse } from 'next/server';
import { getSupabaseServerAdmin } from '@/lib/supabaseAdmin';

export const runtime = 'nodejs';

export async function POST(req: NextRequest) {
  const { guestConvId } = await req.json().catch(() => ({}));
  if (!guestConvId) {
    return NextResponse.json({ error: 'Missing guestConvId' }, { status: 400 });
  }

  const token = req.headers.get('authorization')?.replace('Bearer ', '');
  if (!token) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const sb = getSupabaseServerAdmin();
  const { data: userData } = await sb.auth.getUser(token);
  const user = userData?.user;
  if (!user) {
    return NextResponse.json({ error: 'Invalid user' }, { status: 401 });
  }

  const { data, error } = await sb
    .from('conversations')
    .update({ user_id: user.id, is_guest: false })
    .eq('id', guestConvId)
    .is('user_id', null) // ensure only truly guest conversations can be claimed
    .select()
    .single();

  if (error || !data) {
    return NextResponse.json({ error: 'Failed to claim conversation or conversation already claimed.' }, { status: 404 });
  }

  return NextResponse.json({ success: true, claimedConversation: data });
}
