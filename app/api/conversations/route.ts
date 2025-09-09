import { NextRequest, NextResponse } from 'next/server';

import { ensureUser } from '@/lib/auth';
import { prisma } from '@/lib/prisma';
import { FREE_TRIAL_SECONDS } from '@/lib/server/env.server';

export const dynamic = 'force-dynamic';

// GET all conversations for the authenticated user
export async function GET() {
  const user = await ensureUser();
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  const rows = await prisma.conversation.findMany({
    where: { userId: user.id },
    orderBy: { updatedAt: 'desc' },
    select: { id: true, title: true, createdAt: true, updatedAt: true },
  });
  // shape parity with previous response keys
  return NextResponse.json(
    rows.map((r: typeof rows[number]) => ({
      id: r.id,
      title: r.title,
      created_at: r.createdAt,
      updated_at: r.updatedAt,
    })),
  );
}

// POST to create a new conversation
export async function POST(req: NextRequest) {
  const user = await ensureUser();
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  const { title } = await req.json().catch(() => ({}));
  const conv = await prisma.conversation.create({
    data: {
      userId: user.id,
      title: title || 'New Conversation',
      isGuest: false,
      secondsRemaining: null,
    },
    select: { id: true, title: true, createdAt: true, updatedAt: true },
  });
  return NextResponse.json({
    id: conv.id,
    title: conv.title,
    created_at: conv.createdAt,
    updated_at: conv.updatedAt,
  });
}
