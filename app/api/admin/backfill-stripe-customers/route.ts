import { NextRequest, NextResponse } from 'next/server';

export const runtime = 'nodejs';

// One-off endpoint to backfill profiles.stripe_customer_id for existing supporters.
// Protected: requires an admin token via header X-Admin-Token matching env.ADMIN_TOKEN.
export async function POST(req: NextRequest) {
  const ADMIN_TOKEN = process.env.ADMIN_TOKEN || '';
  if (!ADMIN_TOKEN) return new NextResponse('Disabled', { status: 403 });
  const provided = req.headers.get('x-admin-token') || '';
  if (provided !== ADMIN_TOKEN) return new NextResponse('Forbidden', { status: 403 });

  // Supabase removed: this endpoint now returns stub response
  return NextResponse.json({ count: 0, results: [], stub: true });
}
