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
    select: { id: true, text: true, role: true, createdAt: true },
  });
  return NextResponse.json(
    msgs.map((m) => ({
      id: m.id,
      text: m.text,
      role: m.role,
      // backward compatibility: expose sender alias ('assistant' -> 'ai')
      sender: m.role === 'assistant' ? 'ai' : m.role,
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
  const body = await req.json().catch(() => ({}));
  const text: unknown = body.text;
  // accept either role or legacy sender
  let role: string | undefined = body.role || body.sender;
  if (role === 'ai') role = 'assistant';
  if (
    !text ||
    typeof text !== 'string' ||
    !role ||
    !['user', 'assistant', 'system'].includes(role)
  ) {
    return NextResponse.json({ error: 'Invalid payload' }, { status: 400 });
  }
  const m = await prisma.message.create({
    data: {
      conversationId: conv.id,
      text,
      role,
      userId: role === 'user' ? user.id : undefined,
    },
    select: { id: true, text: true, role: true, createdAt: true },
  });
  return NextResponse.json({
    id: m.id,
    text: m.text,
    role: m.role,
    sender: m.role === 'assistant' ? 'ai' : m.role,
    created_at: m.createdAt,
  });
}
