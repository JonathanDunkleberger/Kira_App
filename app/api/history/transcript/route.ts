export const dynamic = 'force-dynamic';
import { NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { ensureUser } from '@/lib/auth';

export async function GET(req: Request) {
  const url = new URL(req.url);
  const chatSessionId = url.searchParams.get('chatSessionId');
  if (!chatSessionId) return NextResponse.json({ error: 'missing chatSessionId' }, { status: 400 });

  const user = await ensureUser();
  if (!user) return NextResponse.json({ error: 'unauthorized' }, { status: 401 });

  try {
    const convo = await prisma.conversation.findFirst({
      where: { id: chatSessionId, userId: user.id },
      select: { id: true },
    });
    if (!convo) return NextResponse.json({ error: 'not found' }, { status: 404 });
    // Raw query to ensure we read the current role column even if TS client cache lags
    const rows = await prisma.$queryRaw<Array<{ id: string; text: string; role: string; createdAt: Date }>>`
      SELECT id, text, role, "createdAt" FROM "public"."app_messages"
      WHERE "conversationId" = ${chatSessionId}
      ORDER BY "createdAt" ASC
    `;
    return NextResponse.json(
      rows.map((m) => ({
        id: m.id,
        role: m.role,
        content: m.text,
        sender: m.role === 'assistant' ? 'ai' : m.role,
        created_at: m.createdAt,
      })),
      { headers: { 'Cache-Control': 'no-store' } },
    );
  } catch (e: any) {
    return NextResponse.json({ error: e.message || 'query failed' }, { status: 500 });
  }
}
