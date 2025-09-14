import { NextRequest, NextResponse } from 'next/server';
import { currentUser } from '@clerk/nextjs/server';

import { prisma } from '../../../lib/server/prisma';
import { ensureUser } from '../../../lib/auth';

export const dynamic = 'force-dynamic';

export async function GET() {
  const cu = await currentUser();
  if (!cu) return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
  const conversations = await prisma.conversation.findMany({
    where: { userId: cu.id },
    orderBy: { updatedAt: 'desc' },
    select: { id: true, title: true, createdAt: true, updatedAt: true },
  });
  return NextResponse.json(conversations);
}

export async function POST(req: NextRequest) {
  const user = await ensureUser();
  if (!user) return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
  const body = await req.json().catch(() => ({}));
  const title = (body?.title || 'New Conversation').slice(0, 120);
  const convo = await prisma.conversation.create({
    data: { userId: user.id, isGuest: false, title },
    select: { id: true, title: true, createdAt: true, updatedAt: true },
  });
  return NextResponse.json(convo, { status: 201 });
}
