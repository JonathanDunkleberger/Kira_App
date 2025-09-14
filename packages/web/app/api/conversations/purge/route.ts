import { NextRequest, NextResponse } from 'next/server';
import { currentUser } from '@clerk/nextjs/server';

import { prisma } from '../../../../lib/server/prisma';

export const dynamic = 'force-dynamic';

export async function POST(_req: NextRequest) {
  const cu = await currentUser();
  if (!cu) return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
  await prisma.message.deleteMany({ where: { conversation: { userId: cu.id } } });
  await prisma.conversation.deleteMany({ where: { userId: cu.id } });
  return NextResponse.json({ ok: true });
}
