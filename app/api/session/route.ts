import { NextRequest, NextResponse } from 'next/server';
import { env, FREE_TRIAL_SECONDS } from '@/lib/env';
import { getSupabaseServerAdmin } from '@/lib/supabaseAdmin';
import { ensureEntitlements, getSecondsRemaining } from '@/lib/usage';
import { randomUUID } from 'crypto';

export const runtime = 'nodejs';

export async function GET(req: NextRequest) {
  const origin = req.headers.get('origin') || env.APP_URL;
  if (origin !== env.ALLOWED_ORIGIN && !origin.includes(new URL(env.APP_URL).host)) {
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

  await ensureEntitlements(userId, FREE_TRIAL_SECONDS);
  const remaining = await getSecondsRemaining(userId);

  // short-lived session token (opaque) – for MVP we just UUID
  const sessionToken = randomUUID();

  return NextResponse.json({ token: sessionToken, secondsRemaining: remaining }, {
    headers: { 'Access-Control-Allow-Origin': origin }
  });
}
