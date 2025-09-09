export const dynamic = 'force-dynamic';
export const revalidate = 0;
// export const runtime = 'nodejs'; // uncomment if edge runtime accidentally picked

import { NextResponse } from 'next/server';
import { cookies } from 'next/headers';
import { createServerClient } from '@supabase/ssr';

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export async function GET(_req: Request, { params }: { params: { id: string } }) {
  try {
    const chatSessionId = params?.id?.trim();
    if (!chatSessionId || !UUID_RE.test(chatSessionId)) {
      return NextResponse.json({ error: 'invalid_chatSessionId' }, { status: 400 });
    }

    const cookieMaybe = cookies();
    const cookieStore: any = typeof (cookieMaybe as any).then === 'function' ? await cookieMaybe : cookieMaybe;
    const supa = createServerClient(process.env.SUPABASE_URL!, process.env.SUPABASE_ANON_KEY!, {
      cookies: { get: (n: string) => cookieStore.get?.(n)?.value },
    });

    const { data: { user }, error: uerr } = await supa.auth.getUser();
    if (uerr) return NextResponse.json({ error: 'auth_error', detail: uerr.message }, { status: 500 });
    if (!user) return NextResponse.json({ error: 'unauthorized' }, { status: 401 });

    const { data: sess, error: se } = await supa
      .from('chat_sessions')
      .select('id')
      .eq('id', chatSessionId)
      .eq('user_id', user.id)
      .maybeSingle();
    if (se) return NextResponse.json({ error: 'session_lookup_failed', detail: se.message }, { status: 500 });
    if (!sess) return NextResponse.json({ error: 'not_found' }, { status: 404 });

    const { data: messages, error: me } = await supa
      .from('messages')
      .select('*')
      .eq('chat_session_id', chatSessionId)
      .order('created_at', { ascending: true });
    if (me) return NextResponse.json({ error: 'messages_query_failed', detail: me.message }, { status: 500 });

    return NextResponse.json(messages ?? [], { headers: { 'Cache-Control': 'no-store' } });
  } catch (e: any) {
    return NextResponse.json({ error: 'unhandled', detail: e?.message ?? String(e) }, { status: 500 });
  }
}
