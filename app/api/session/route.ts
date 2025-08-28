import { NextRequest, NextResponse } from 'next/server';
import { randomUUID } from 'crypto';
// Defer env reads to request-time
import { getSupabaseServerAdmin } from '@/lib/supabaseAdmin';
import { ensureEntitlements, getSecondsRemaining } from '@/lib/usage';

export const runtime = 'nodejs';

export async function GET(req: NextRequest) {
  const APP_URL = process.env.APP_URL || '';
  const ALLOWED_ORIGIN = process.env.ALLOWED_ORIGIN || '';
  const origin = req.headers.get('origin') || APP_URL;
  if (APP_URL && ALLOWED_ORIGIN && origin !== ALLOWED_ORIGIN && !origin.includes(new URL(APP_URL).host)) {
    return new NextResponse('Forbidden origin', { status: 403 });
  }

  const auth = req.headers.get('authorization') || '';
  const token = auth.startsWith('Bearer ') ? auth.slice(7) : null;
  if (!token) return new NextResponse('Missing auth', { status: 401 });

  // Validate the Supabase access token and get the user id
  const sb = getSupabaseServerAdmin();
  const { data: userData, error } = await sb.auth.getUser(token);
  if (error || !userData.user) return new NextResponse('Invalid auth', { status: 401 });
  const userId = userData.user.id;
  const fts = parseInt(process.env.FREE_TRIAL_SECONDS || '600', 10);
  await ensureEntitlements(userId, fts);
  const remaining = await getSecondsRemaining(userId);

  return NextResponse.json({ token: randomUUID(), secondsRemaining: remaining }, {
    headers: { 'Access-Control-Allow-Origin': origin },
  });
}
