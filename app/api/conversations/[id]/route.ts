import { NextRequest, NextResponse } from 'next/server';
import { getSupabaseServerAdmin } from '@/lib/supabaseAdmin';

export const runtime = 'nodejs';

export async function GET(req: NextRequest, { params }: { params: { id: string }}) {
  const token = req.headers.get('authorization')?.replace('Bearer ', '');
  if (!token) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const sb = getSupabaseServerAdmin();
  const { data: userData } = await sb.auth.getUser(token);
  const userId = userData?.user?.id;
  if (!userId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const convoId = params.id;

  const { data: convo, error: e1 } = await sb
    .from('conversations').select('id,title,updated_at').eq('id', convoId).single();
  if (e1 || !convo) return NextResponse.json({ error: 'Not found' }, { status: 404 });

  const { data: msgs, error: e2 } = await sb
    .from('messages')
    .select('id,role,content,created_at')
    .eq('conversation_id', convoId)
    .order('created_at', { ascending: true });

  if (e2) return NextResponse.json({ error: e2.message }, { status: 500 });
  return NextResponse.json({ conversation: convo, messages: msgs ?? [] });
}

export async function PATCH(req: NextRequest, { params }: { params: { id: string }}) {
  const token = req.headers.get('authorization')?.replace('Bearer ', '');
  if (!token) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const sb = getSupabaseServerAdmin();
  const { data: userData } = await sb.auth.getUser(token);
  const userId = userData?.user?.id;
  if (!userId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const convoId = params.id;
  const { title } = await req.json().catch(() => ({}));
  const { data, error } = await sb
    .from('conversations')
    .update({ title, updated_at: new Date().toISOString() })
    .eq('id', convoId)
    .select('id,title,updated_at')
    .single();

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ conversation: data });
}

export async function DELETE(req: NextRequest, { params }: { params: { id: string }}) {
  const token = req.headers.get('authorization')?.replace('Bearer ', '');
  if (!token) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const sb = getSupabaseServerAdmin();
  const { data: userData } = await sb.auth.getUser(token);
  const userId = userData?.user?.id;
  if (!userId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const convoId = params.id;
  const { error } = await sb.from('conversations').delete().eq('id', convoId);
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ ok: true });
}
