import { NextRequest, NextResponse } from 'next/server';
import { ensureUser } from '@/lib/auth';
import { prisma } from '@/lib/prisma';

export const dynamic = 'force-dynamic';

export async function GET(_req: NextRequest, { params }: { params: { id: string } }) {
  const user = await ensureUser();
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  const conv = await prisma.conversation.findUnique({ where: { id: params.id } });
  if (!conv || conv.userId !== user.id)
    return NextResponse.json({ error: 'Not found' }, { status: 404 });
  const msgs = await prisma.message.findMany({
    where: { conversationId: params.id },
    orderBy: { createdAt: 'asc' },
    select: { id: true, text: true, sender: true, createdAt: true },
  });
  return NextResponse.json(
    msgs.map((m: (typeof msgs)[number]) => ({
      id: m.id,
      text: m.text,
      sender: m.sender,
      created_at: m.createdAt,
    })),
  );
}

export async function POST(req: NextRequest, { params }: { params: { id: string } }) {
  const user = await ensureUser();
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  const conv = await prisma.conversation.findUnique({ where: { id: params.id } });
  if (!conv || conv.userId !== user.id)
    return NextResponse.json({ error: 'Not found' }, { status: 404 });
  const { text, sender } = await req.json().catch(() => ({}));
  if (!text || typeof text !== 'string' || !sender || (sender !== 'user' && sender !== 'ai')) {
    return NextResponse.json({ error: 'Invalid payload' }, { status: 400 });
  }
  const m = await prisma.message.create({
    data: { conversationId: conv.id, text, sender },
    select: { id: true, text: true, sender: true, createdAt: true },
  });
  return NextResponse.json({
    id: m.id,
    text: m.text,
    sender: m.sender,
    created_at: m.createdAt,
  });
}
