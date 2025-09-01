import { NextResponse } from 'next/server';

export const runtime = 'nodejs';

export async function GET() {
  return NextResponse.json({ error: 'Deprecated. Use /api/streak (GET).' }, { status: 410 });
}
