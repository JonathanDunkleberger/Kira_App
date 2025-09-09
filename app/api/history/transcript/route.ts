export const dynamic = 'force-dynamic';
import { NextResponse } from 'next/server';
import { cookies } from 'next/headers';
import { createServerClient } from '@supabase/ssr';

export async function GET(req: Request) {
  const url = new URL(req.url);
  const chatSessionId = url.searchParams.get('chatSessionId');
  if (!chatSessionId) return NextResponse.json({ error: 'missing chatSessionId' }, { status: 400 });

  const cookieStore: any = cookies();
  const supa = createServerClient(process.env.SUPABASE_URL!, process.env.SUPABASE_ANON_KEY!, {
    cookies: {
      get: (name: string) => cookieStore.get(name)?.value,
    },
  });
  const {
    data: { user },
  } = await supa.auth.getUser();
  if (!user) return NextResponse.json({ error: 'unauthorized' }, { status: 401 });

  const { data: sess, error: se } = await supa
    .from('chat_sessions')
    .select('id')
    .eq('id', chatSessionId)
    .eq('user_id', user.id)
    .maybeSingle();
  if (se || !sess) return NextResponse.json({ error: 'not found' }, { status: 404 });

  const { data, error } = await supa
    .from('messages')
    .select('*')
    .eq('conversation_id', chatSessionId)
    .order('created_at', { ascending: true });
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json(data, { headers: { 'Cache-Control': 'no-store' } });
}
