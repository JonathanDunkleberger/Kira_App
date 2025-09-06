import { NextRequest, NextResponse } from 'next/server';
import { getSupabaseServerAdmin } from '@/lib/server/supabaseAdmin';

export const dynamic = 'force-dynamic';

export async function GET(req: NextRequest, { params }: { params: { id: string } }) {
  const token = req.headers.get('authorization')?.replace('Bearer ', '');
  if (!token) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const sb = getSupabaseServerAdmin();
  const { data: { user } } = await sb.auth.getUser(token);
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const conversationId = params.id;
  // Ensure ownership
  const { data: convo, error: convoErr } = await sb
    .from('conversations')
    .select('id,user_id')
    .eq('id', conversationId)
    .maybeSingle();
  if (convoErr) return NextResponse.json({ error: 'Failed to fetch conversation' }, { status: 500 });
  if (!convo || convo.user_id !== user.id) return NextResponse.json({ error: 'Forbidden' }, { status: 403 });

  const { data, error } = await sb
    .from('messages')
    .select('id, role, content, created_at')
    .eq('conversation_id', conversationId)
    .order('created_at', { ascending: true });

  if (error) {
    console.error('Error fetching messages:', error);
    return NextResponse.json({ error: 'Failed to fetch messages' }, { status: 500 });
  }

  return NextResponse.json(data ?? []);
}
// Deprecated: handled by WebSocket + Supabase client queries
