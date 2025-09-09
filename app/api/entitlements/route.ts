export const dynamic = 'force-dynamic';
export const revalidate = 0;
// export const runtime = 'nodejs';

import { NextResponse } from 'next/server';
import { cookies } from 'next/headers';
import { createServerClient } from '@supabase/ssr';

const n = (v: any, d: number) => {
  const x = Number(v);
  return Number.isFinite(x) ? x : d;
};

export async function GET(req: Request) {
  const url = new URL(req.url);
  const _chatSessionId = url.searchParams.get('chatSessionId'); // accepted but unused now

  const DEFAULT_DAILY_FREE_SECONDS = n(process.env.DEFAULT_DAILY_FREE_SECONDS, 900);
  const DEFAULT_PRO_PER_CHAT_SECONDS = n(process.env.DEFAULT_PRO_PER_CHAT_SECONDS, 7200);

  const SUPABASE_URL = process.env.SUPABASE_URL;
  const SUPABASE_ANON_KEY = process.env.SUPABASE_ANON_KEY;

  if (!SUPABASE_URL || !SUPABASE_ANON_KEY) {
    return NextResponse.json(
      {
        plan: 'free',
        todaySecondsLimit: DEFAULT_DAILY_FREE_SECONDS,
        chatSecondsCap: DEFAULT_PRO_PER_CHAT_SECONDS,
      },
      { headers: { 'Cache-Control': 'no-store' } },
    );
  }

  const cookieStore = await cookies();
  const supa = createServerClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
    cookies: { get: (name) => cookieStore.get(name)?.value },
  });

  const {
    data: { user },
    error: uerr,
  } = await supa.auth.getUser();
  if (uerr) {
    return NextResponse.json(
      {
        plan: 'free',
        todaySecondsLimit: DEFAULT_DAILY_FREE_SECONDS,
        chatSecondsCap: DEFAULT_PRO_PER_CHAT_SECONDS,
      },
      { headers: { 'Cache-Control': 'no-store' } },
    );
  }

  if (!user) {
    return NextResponse.json(
      {
        plan: 'free',
        todaySecondsLimit: DEFAULT_DAILY_FREE_SECONDS,
        chatSecondsCap: DEFAULT_PRO_PER_CHAT_SECONDS,
      },
      { headers: { 'Cache-Control': 'no-store' } },
    );
  }

  const { data: ent, error } = await supa
    .from('user_entitlements')
    .select('plan,daily_free_seconds,per_chat_cap_seconds')
    .eq('user_id', user.id)
    .maybeSingle();

  if (error) {
    return NextResponse.json(
      {
        plan: 'free',
        todaySecondsLimit: DEFAULT_DAILY_FREE_SECONDS,
        chatSecondsCap: DEFAULT_PRO_PER_CHAT_SECONDS,
      },
      { headers: { 'Cache-Control': 'no-store' } },
    );
  }

  const plan = ent?.plan ?? 'free';
  const todaySecondsLimit =
    plan === 'pro' ? 0 : n(ent?.daily_free_seconds, DEFAULT_DAILY_FREE_SECONDS);
  const chatSecondsCap = n(ent?.per_chat_cap_seconds, DEFAULT_PRO_PER_CHAT_SECONDS);

  return NextResponse.json(
    { plan, todaySecondsLimit, chatSecondsCap },
    { headers: { 'Cache-Control': 'no-store' } },
  );
}
