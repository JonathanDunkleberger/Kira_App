import { NextRequest, NextResponse } from 'next/server';
import { ensureUser } from '@/lib/auth';
import { prisma } from '@/lib/prisma';

export const dynamic = 'force-dynamic';

// DELETE a single conversation by its ID (must belong to user)
export async function DELETE(_req: NextRequest, { params }: { params: { id: string } }) {
  const user = await ensureUser();
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  await prisma.conversation.deleteMany({ where: { id: params.id, userId: user.id } });
  return NextResponse.json({ success: true });
}

// PATCH rename conversation title
export async function PATCH(req: NextRequest, { params }: { params: { id: string } }) {
  const user = await ensureUser();
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  const { title } = await req.json().catch(() => ({}) as any);
  if (!title || typeof title !== 'string') {
    return NextResponse.json({ error: 'Invalid title' }, { status: 400 });
  }
  const conv = await prisma.conversation.updateMany({
    where: { id: params.id, userId: user.id },
    data: { title },
  });
  if (conv.count === 0) return NextResponse.json({ error: 'Not found' }, { status: 404 });
  const refreshed = await prisma.conversation.findUnique({
    where: { id: params.id },
    select: { id: true, title: true, createdAt: true, updatedAt: true },
  });
  if (!refreshed) return NextResponse.json({ error: 'Not found' }, { status: 404 });
  return NextResponse.json({
    id: refreshed.id,
    title: refreshed.title,
    created_at: refreshed.createdAt,
    updated_at: refreshed.updatedAt,
  });
}
