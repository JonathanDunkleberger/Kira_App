import { NextResponse } from 'next/server';
import { auth } from '@clerk/nextjs/server';
import { prisma } from '../../../../lib/server/prisma';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET() {
  const { userId } = await auth();
  if (!userId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  const sub = await prisma.subscription.findFirst({ where: { userId }, orderBy: { createdAt: 'desc' } });
  if (!sub) return NextResponse.json({ subscription: null });
  return NextResponse.json({
    subscription: {
      status: sub.status,
      plan: sub.plan,
      currentPeriodEnd: sub.currentPeriodEnd,
      cancelAt: sub.cancelAt,
      canceledAt: sub.canceledAt,
    },
  });
}
