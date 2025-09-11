import { NextRequest, NextResponse } from 'next/server';

// Supabase removed: stub endpoint that validates payload and returns success.

export const runtime = 'nodejs';

export async function POST(req: NextRequest) {
  const token = req.headers.get('authorization')?.replace('Bearer ', '');
  if (!token) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  // TODO integrate with Clerk authentication (token -> userId)
  const userId = 'stub-user';

  const { conversationId, role, content } = await req.json().catch(() => ({}));
  if (!conversationId || !role || !content) {
    return NextResponse.json({ error: 'Missing fields' }, { status: 400 });
  }

  // Persist skipped (placeholder)
  console.log('[messages] (stub) save', { conversationId, role, content: content.slice(0, 40) });

  return NextResponse.json({ ok: true });
}
