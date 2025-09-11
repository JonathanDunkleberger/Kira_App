export const dynamic = 'force-dynamic';
import { NextResponse } from 'next/server';
// Supabase removed; placeholder auth to be replaced with Clerk.
import { prisma } from '@/lib/prisma';

export async function GET() {
  // TODO: derive userId from Clerk auth; for now return empty list if unauthenticated.
  const userId = null; // placeholder
  if (!userId) return NextResponse.json([], { headers: { 'Cache-Control': 'no-store' } });

  try {
    const convos = await prisma.conversation.findMany({
  where: { userId },
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
