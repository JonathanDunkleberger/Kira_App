export const dynamic = 'force-dynamic';

import { NextResponse } from 'next/server';
import { createServerClient } from '@supabase/ssr';
import type { CookieOptions } from '@supabase/ssr';

export async function GET(_req: Request, { params }: { params: { id: string } }) {
  // Manual cookie parsing (avoid type issues in some Next runtimes)
  const cookieHeader = (await (globalThis as any).headers?.get?.('cookie')) || '';
  const map: Record<string, string> = {};
  cookieHeader.split(/;\s*/).forEach((p: string) => {
    if (!p) return;
    const i = p.indexOf('=');
    if (i === -1) return;
    const k = decodeURIComponent(p.slice(0, i));
    const v = decodeURIComponent(p.slice(i + 1));
    map[k] = v;
  });
  const supa = createServerClient(
    process.env.SUPABASE_URL!,
    process.env.SUPABASE_ANON_KEY!,
    {
      cookies: {
        get(name: string) {
          return map[name];
        },
        set(name: string, value: string, options: CookieOptions) {
          // noop: API route not setting auth cookies
        },
        remove(name: string, options: CookieOptions) {
          // noop
        },
      },
    },
  );

  const {
    data: { user },
  } = await supa.auth.getUser();
  if (!user) return NextResponse.json({ error: 'unauthorized' }, { status: 401 });

  const chatSessionId = params.id;
  // verify ownership in chat_sessions
  const { data: sess, error: sessErr } = await supa
    .from('chat_sessions')
    .select('id')
    .eq('id', chatSessionId)
    .eq('user_id', user.id)
    .maybeSingle();
  if (sessErr) return NextResponse.json({ error: 'failed to fetch session' }, { status: 500 });
  if (!sess) return NextResponse.json({ error: 'not found' }, { status: 404 });

  const { data, error } = await supa
    .from('messages')
    .select('*')
    .eq('chat_session_id', chatSessionId)
    .order('created_at', { ascending: true });
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json(data ?? [], { headers: { 'Cache-Control': 'no-store' } });
}
