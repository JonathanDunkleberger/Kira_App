export const dynamic = 'force-dynamic';
import { NextResponse } from 'next/server';
import { cookies } from 'next/headers';
import { createServerClient } from '@supabase/ssr';
import { prisma } from '@/lib/prisma';

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

  try {
  const convos = await prisma.conversation.findMany({
      where: { userId: user.id },
      orderBy: { createdAt: 'desc' },
      take: 100,
      select: { id: true, createdAt: true, updatedAt: true, secondsRemaining: true },
    });
    return NextResponse.json(
      convos.map(
        (c: { id: string; createdAt: Date; updatedAt: Date; secondsRemaining: number | null }) => ({
          id: c.id,
          started_at: c.createdAt,
          ended_at: c.updatedAt,
          seconds_elapsed: c.secondsRemaining ?? 0, // interpret remaining if you later change semantics
        }),
      ),
      { headers: { 'Cache-Control': 'no-store' } },
    );
  } catch (e: any) {
    return NextResponse.json({ error: e.message || 'query failed' }, { status: 500 });
  }
}
