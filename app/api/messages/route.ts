import { NextRequest, NextResponse } from 'next/server';
import { getSupabaseServerAdmin } from '@/lib/server/supabaseAdmin';

export const runtime = 'nodejs';

export async function POST(req: NextRequest) {
  const token = req.headers.get('authorization')?.replace('Bearer ', '');
  if (!token) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const sb = getSupabaseServerAdmin();
  const { data: userData } = await sb.auth.getUser(token);
  const userId = userData?.user?.id;
  if (!userId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const { conversationId, role, content } = await req.json().catch(() => ({}));
  if (!conversationId || !role || !content) {
    return NextResponse.json({ error: 'Missing fields' }, { status: 400 });
  }

  const { error: e1 } = await sb
    .from('messages')
    .insert({ conversation_id: conversationId, role, content });
  if (e1) return NextResponse.json({ error: e1.message }, { status: 500 });

  await sb
    .from('conversations')
    .update({ updated_at: new Date().toISOString() })
    .eq('id', conversationId);

  return NextResponse.json({ ok: true });
}
