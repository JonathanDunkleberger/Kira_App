import { NextRequest, NextResponse } from 'next/server';
import { currentUser } from '@clerk/nextjs/server';

import { prisma } from '../../../../lib/server/prisma';

export const dynamic = 'force-dynamic';

export async function PATCH(req: NextRequest, { params }: { params: { id: string } }) {
  const cu = await currentUser();
  if (!cu) return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
  const body = await req.json().catch(() => ({}));
  const title = (body?.title || '').slice(0, 120).trim();
  if (!title) return NextResponse.json({ error: 'empty_title' }, { status: 400 });
  try {
    const updated = await prisma.conversation.update({
      where: { id: params.id, userId: cu.id },
      data: { title },
      select: { id: true, title: true, updatedAt: true },
    });
    return NextResponse.json(updated);
  } catch {
    return NextResponse.json({ error: 'not_found' }, { status: 404 });
  }
}

export async function DELETE(_req: NextRequest, { params }: { params: { id: string } }) {
  const cu = await currentUser();
  if (!cu) return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
  try {
    await prisma.conversation.delete({ where: { id: params.id, userId: cu.id } });
    return new NextResponse(null, { status: 204 });
  } catch {
    return NextResponse.json({ error: 'not_found' }, { status: 404 });
  }
}
