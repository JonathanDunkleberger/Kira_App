import { NextResponse } from 'next/server';

export const runtime = 'nodejs';

// Deprecated: use /api/stripe/portal instead.
export async function POST() {
  return NextResponse.json({ error: 'Deprecated. Use /api/stripe/portal.' }, { status: 410 });
}
