// packages/web/app/api/user/name/route.ts
import { NextResponse } from 'next/server';
import { auth } from '@clerk/nextjs/server';
import { prisma } from '../../../../lib/server/prisma';

export async function GET() {
  const { userId } = auth();
  if (!userId) return new NextResponse('Unauthorized', { status: 401 });
  try {
    const user = await prisma.user.findUnique({ where: { id: userId }, select: { id: true, name: true } });
    if (!user) return new NextResponse('Not found', { status: 404 });
    return NextResponse.json(user);
  } catch (e) {
    console.error('[USER_NAME_GET]', e);
    return new NextResponse('Internal Error', { status: 500 });
  }
}

export async function PATCH(request: Request) {
  const { userId } = auth();
  if (!userId) {
    return new NextResponse('Unauthorized', { status: 401 });
  }

  let body: any;
  try {
    body = await request.json();
  } catch {
    return new NextResponse('Invalid JSON', { status: 400 });
  }
  const { name } = body || {};

  if (typeof name !== 'string' || name.trim().length < 1 || name.trim().length > 50) {
    return new NextResponse('Invalid name', { status: 400 });
  }

  try {
    const updatedUser = await prisma.user.update({
      where: { id: userId },
      data: { name: name.trim() },
    });
    return NextResponse.json({ id: updatedUser.id, name: updatedUser.name });
  } catch (error) {
    console.error('[USER_NAME_PATCH]', error);
    return new NextResponse('Internal Error', { status: 500 });
  }
}
