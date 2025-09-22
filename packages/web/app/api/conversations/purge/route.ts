// packages/web/app/api/conversations/purge/route.ts
import { NextResponse } from 'next/server';
import { auth } from '@clerk/nextjs/server';
import { prisma } from '../../../../lib/server/prisma';

export async function POST() {
  const { userId } = auth();
  if (!userId) {
    return new NextResponse('Unauthorized', { status: 401 });
  }
  try {
    await prisma.conversation.deleteMany({ where: { userId } });
    return new NextResponse(null, { status: 204 });
  } catch (error) {
    console.error('[CONVERSATIONS_PURGE]', error);
    return new NextResponse('Internal Error', { status: 500 });
  }
}
