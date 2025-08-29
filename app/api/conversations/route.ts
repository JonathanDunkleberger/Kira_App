import { NextRequest, NextResponse } from 'next/server';
import { getSupabaseServerAdmin } from '@/lib/supabaseAdmin';

export const runtime = 'nodejs';

export async function GET(req: NextRequest) {
  const token = req.headers.get('authorization')?.replace('Bearer ', '');
  if (!token) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const sb = getSupabaseServerAdmin();
  const { data: userData } = await sb.auth.getUser(token);
  const userId = userData?.user?.id;
  if (!userId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const { data, error } = await sb
    .from('conversations')
    .select('id,title,created_at,updated_at')
    .eq('user_id', userId)
    .order('updated_at', { ascending: false });

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ conversations: data ?? [] });
}

export async function POST(req: NextRequest) {
  const token = req.headers.get('authorization')?.replace('Bearer ', '');
  if (!token) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const sb = getSupabaseServerAdmin();
  const { data: userData } = await sb.auth.getUser(token);
  const userId = userData?.user?.id;
  if (!userId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const { title } = await req.json().catch(() => ({}));
  const { data, error } = await sb
    .from('conversations')
    .insert({ user_id: userId, title: title || 'New chat' })
    .select('id,title,created_at,updated_at')
    .single();

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ conversation: data });
}

export async function DELETE(req: NextRequest) {
  const token = req.headers.get('authorization')?.replace('Bearer ', '');
  if (!token) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const sb = getSupabaseServerAdmin();
  const { data: userData } = await sb.auth.getUser(token);
  const userId = userData?.user?.id;
  if (!userId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const { error } = await sb.from('conversations').delete().eq('user_id', userId);
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ ok: true });
}
