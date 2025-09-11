export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const revalidate = 0;

import { NextRequest } from 'next/server';
// Supabase removed: feedback is now a no-op stub (extend with Prisma table later)

export async function POST(req: NextRequest) {
  const body = await req.json().catch(() => ({}));
  const { message, rating, meta } = body || {};
  if (!message || typeof message !== 'string') {
    return new Response('Bad request', { status: 400 });
  }

  // TODO: persist via Prisma (feedback table) - currently just logs.
  try {
    console.log('[feedback] message received', { message, rating, hasMeta: !!meta });
  } catch {}
  return new Response(null, { status: 204 });
}
