export const dynamic = 'force-dynamic';
import { NextResponse } from 'next/server';
import { cookies } from 'next/headers';
import { createServerClient } from '@supabase/ssr';

export async function GET() {
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

  const { data, error } = await supa
    .from('chat_sessions')
    .select('id, created_at, updated_at, seconds_elapsed')
    .eq('user_id', user.id)
    .order('created_at', { ascending: false })
    .limit(100);
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json(
    data.map((d: any) => ({
      id: d.id,
      started_at: d.created_at,
      ended_at: d.updated_at,
      seconds_elapsed: d.seconds_elapsed,
    })),
    { headers: { 'Cache-Control': 'no-store' } },
  );
}
