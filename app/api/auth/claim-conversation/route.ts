import { NextRequest, NextResponse } from 'next/server';

// Supabase removed; directly call stubbed conversation claim logic.
import { claimGuestConversation } from '@/lib/server/conversations';

export const runtime = 'nodejs';

export async function POST(req: NextRequest) {
  const { guestConvId } = await req.json().catch(() => ({}));
  if (!guestConvId) return NextResponse.json({ error: 'Missing guestConvId' }, { status: 400 });

  // Stub auth: extract fake user id from header or default
  const user = { id: req.headers.get('x-user-id') || 'stub-user' };

  try {
    await claimGuestConversation(user.id, guestConvId);
    return NextResponse.json({ success: true, userId: user.id, guestConvId });
  } catch (e: any) {
    console.error('Claim conversation failed:', e?.message || e);
    return NextResponse.json({ error: 'Failed to claim conversation' }, { status: 500 });
  }
}
