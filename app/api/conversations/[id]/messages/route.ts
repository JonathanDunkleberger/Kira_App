export const dynamic = 'force-dynamic';
export const revalidate = 0;
// export const runtime = 'nodejs'; // uncomment if you previously set 'edge'

import { NextResponse } from 'next/server';
import { cookies } from 'next/headers';
import { createServerClient } from '@supabase/ssr';

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export async function GET(_req: Request, { params }: { params: { id: string }}) {
  const chatOrConversationId = params?.id?.trim();
  if (!chatOrConversationId || !UUID_RE.test(chatOrConversationId)) {
    return NextResponse.json({ error: 'invalid_id' }, { status: 400 });
  }

  try {
    // Cookie store (supports potential promise form)
    const cookieMaybe = cookies();
    const cookieStore: any = typeof (cookieMaybe as any).then === 'function' ? await cookieMaybe : cookieMaybe;
    const supa = createServerClient(
      process.env.SUPABASE_URL!,
      process.env.SUPABASE_ANON_KEY!,
      { cookies: { get: (n) => cookieStore.get?.(n)?.value } }
    );

    // 1) Auth
    const { data: { user }, error: uerr } = await supa.auth.getUser();
    if (uerr) return NextResponse.json({ error: 'auth_error', detail: uerr.message }, { status: 500 });
    if (!user) return NextResponse.json({ error: 'unauthorized' }, { status: 401 });

    // 2) Ensure chat_session exists (support legacy conversation_id only data)
    const { data: existingSession, error: sErr } = await supa
      .from('chat_sessions')
      .select('id')
      .eq('id', chatOrConversationId)
      .eq('user_id', user.id)
      .maybeSingle();
    if (sErr) return NextResponse.json({ error: 'session_lookup_failed', detail: sErr.message }, { status: 500 });

    let sessionIdToUse: string | null = existingSession?.id ?? null;

    if (!sessionIdToUse) {
      // Look for legacy messages rows referencing conversation_id
      const { data: legacyMsgs, error: lErr } = await supa
        .from('messages')
        .select('id')
        .eq('conversation_id', chatOrConversationId)
        .limit(1);
      if (lErr) return NextResponse.json({ error: 'legacy_check_failed', detail: lErr.message }, { status: 500 });

      if (legacyMsgs && legacyMsgs.length > 0) {
        // Create a chat_session row on-the-fly so resume + RLS works
        const { data: created, error: cErr } = await supa
          .from('chat_sessions')
          .insert({ id: chatOrConversationId, user_id: user.id })
          .select('id')
          .single();
        if (cErr) return NextResponse.json({ error: 'session_create_failed', detail: cErr.message }, { status: 500 });
        sessionIdToUse = created.id;
        // Optional backfill (commented to avoid unexpected writes):
        // await supa.from('messages')
        //   .update({ chat_session_id: created.id })
        //   .eq('conversation_id', created.id);
      }
    }

    if (!sessionIdToUse) {
      return NextResponse.json({ error: 'not_found' }, { status: 404 });
    }

    // 3) Load messages tolerant to either column
    let messages: any[] = [];
    let qErr: any = null;

    const tryNew = await supa
      .from('messages')
      .select('*')
      .eq('chat_session_id', sessionIdToUse)
      .order('created_at', { ascending: true });
    if (tryNew.error) {
      qErr = tryNew.error;
    } else {
      messages = tryNew.data ?? [];
    }

    if ((messages.length === 0) || (qErr && /column .*chat_session_id.* does not exist/i.test(qErr.message))) {
      const tryLegacy = await supa
        .from('messages')
        .select('*')
        .eq('conversation_id', sessionIdToUse)
        .order('created_at', { ascending: true });
      if (tryLegacy.error) return NextResponse.json({ error: 'messages_query_failed', detail: tryLegacy.error.message }, { status: 500 });
      messages = tryLegacy.data ?? [];
    }

    return NextResponse.json(messages, { headers: { 'Cache-Control': 'no-store' } });
  } catch (e: any) {
    return NextResponse.json({ error: 'unhandled', detail: e?.message ?? String(e) }, { status: 500 });
  }
}
