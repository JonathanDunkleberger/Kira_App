import { NextRequest, NextResponse } from 'next/server';
import { currentUser } from '@clerk/nextjs/server';

import { prisma } from '../../../../../lib/server/prisma';

export const dynamic = 'force-dynamic';

export async function GET(_req: NextRequest, { params }: { params: { id: string } }) {
  const cu = await currentUser();
  if (!cu) return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
  const convo = await prisma.conversation.findFirst({ where: { id: params.id, userId: cu.id } });
  if (!convo) return NextResponse.json({ error: 'not_found' }, { status: 404 });
  const messages = await prisma.message.findMany({
    where: { conversationId: convo.id },
    orderBy: { createdAt: 'asc' },
    select: { id: true, role: true, text: true, createdAt: true },
  });
  return NextResponse.json(messages);
}

export async function POST(req: NextRequest, { params }: { params: { id: string } }) {
  const cu = await currentUser();
  if (!cu) return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
  const convo = await prisma.conversation.findFirst({ where: { id: params.id, userId: cu.id } });
  if (!convo) return NextResponse.json({ error: 'not_found' }, { status: 404 });
  const body = await req.json().catch(() => ({}));
  const role = ['user', 'assistant', 'system'].includes(body?.role) ? body.role : 'user';
  const text = String(body?.text || '').trim().slice(0, 8000);
  if (!text) return NextResponse.json({ error: 'empty_text' }, { status: 400 });
  const msg = await prisma.message.create({
    data: { conversationId: convo.id, role, text },
    select: { id: true, role: true, text: true, createdAt: true },
  });
  await prisma.conversation.update({ where: { id: convo.id }, data: { updatedAt: new Date() } });
  return NextResponse.json(msg, { status: 201 });
}
