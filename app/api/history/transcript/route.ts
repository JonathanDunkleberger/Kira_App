export const dynamic = 'force-dynamic';
import { NextResponse } from 'next/server';
import { cookies } from 'next/headers';
import { createServerClient } from '@supabase/ssr';
import { PrismaClient } from '@prisma/client';

export async function GET(req: Request) {
  const url = new URL(req.url);
  const chatSessionId = url.searchParams.get('chatSessionId');
  if (!chatSessionId) return NextResponse.json({ error: 'missing chatSessionId' }, { status: 400 });

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

  const prisma = new PrismaClient();
  try {
    const convo = await prisma.conversation.findFirst({
      where: { id: chatSessionId, userId: user.id },
      select: { id: true },
    });
    if (!convo) return NextResponse.json({ error: 'not found' }, { status: 404 });
    const msgs = await prisma.message.findMany({
      where: { conversationId: chatSessionId },
      orderBy: { createdAt: 'asc' },
      select: { id: true, text: true, sender: true, createdAt: true },
    });
    return NextResponse.json(
  msgs.map((m: { id: string; text: string; sender: string; createdAt: Date }) => ({
        id: m.id,
        role: m.sender,
        content: m.text,
        created_at: m.createdAt,
      })),
      { headers: { 'Cache-Control': 'no-store' } },
    );
  } catch (e: any) {
    return NextResponse.json({ error: e.message || 'query failed' }, { status: 500 });
  }
}
