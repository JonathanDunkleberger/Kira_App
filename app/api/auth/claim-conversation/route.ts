import { NextRequest, NextResponse } from 'next/server';

import { getSupabaseServerAdmin } from '@/lib/server/supabaseAdmin';
import { claimGuestConversation } from '@/lib/server/conversations';

export const runtime = 'nodejs';

export async function POST(req: NextRequest) {
  const { guestConvId } = await req.json().catch(() => ({}));
  if (!guestConvId) return NextResponse.json({ error: 'Missing guestConvId' }, { status: 400 });

  const token = req.headers.get('authorization')?.replace('Bearer ', '');
  if (!token) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const sb = getSupabaseServerAdmin();
  const { data: userData } = await sb.auth.getUser(token);
  const user = userData?.user;
  if (!user) return NextResponse.json({ error: 'Invalid user' }, { status: 401 });

  try {
    await claimGuestConversation(user.id, guestConvId);
    return NextResponse.json({ success: true });
  } catch (e: any) {
    console.error('Claim conversation failed:', e?.message || e);
    return NextResponse.json({ error: 'Failed to claim conversation' }, { status: 500 });
  }
}
