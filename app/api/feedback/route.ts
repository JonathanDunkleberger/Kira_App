export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const revalidate = 0;

import { NextRequest } from 'next/server';
import { PrismaClient } from '@prisma/client';
// Feedback now persisted if Prisma is configured; falls back to log otherwise.
const prisma = new PrismaClient();

export async function POST(req: NextRequest) {
  const body = await req.json().catch(() => ({}) as any);
  const { message, rating, meta, stars, note, conversationId, userId } = body || {};

  // Accept either old shape (message+rating) or new shape (stars+note)
  const finalStars = typeof stars === 'number' ? stars : typeof rating === 'number' ? rating : null;
  const finalNote = typeof note === 'string' ? note : typeof message === 'string' ? message : null;
  if (finalStars == null && !finalNote) {
    return new Response('Bad request', { status: 400 });
  }

  try {
    if (prisma && (prisma as any).feedback) {
      await (prisma as any).feedback.create({
        data: {
          stars: finalStars || 0,
          note: finalNote,
          conversationId: conversationId || meta?.conversationId || null,
          userId: userId || null,
        },
      });
    } else if (finalStars != null || finalNote) {
      console.log('[feedback:stub-persist]', { finalStars, finalNote, conversationId });
    } else {
      console.log('[feedback:fallback]', { finalStars, finalNote });
    }
  } catch (e: any) {
    console.error('[feedback:error]', e?.message || e);
    // Still consider returning 204 to avoid user friction; optionally 500
    return new Response('Failed', { status: 500 });
  }
  return new Response(null, { status: 204 });
}
