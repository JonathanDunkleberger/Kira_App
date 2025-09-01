import { NextResponse } from 'next/server';

export const runtime = 'nodejs';

export async function POST() {
  return NextResponse.json({ error: 'Deprecated. Use /api/streak (POST).' }, { status: 410 });
}
