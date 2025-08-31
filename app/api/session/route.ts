import { NextRequest, NextResponse } from 'next/server';
import { randomUUID } from 'crypto';
import { env, FREE_TRIAL_SECONDS } from '@/lib/env';
import { getSupabaseServerAdmin } from '@/lib/supabaseAdmin';
import { ensureEntitlements, getEntitlement, getDailySecondsRemaining } from '@/lib/usage';

export const runtime = 'nodejs';

export async function GET(req: NextRequest) {
  const origin = req.headers.get('origin') || env.APP_URL;
  const allowedHost = new URL(env.APP_URL).host;
  const isAllowed =
    origin === env.ALLOWED_ORIGIN ||
    origin.includes(allowedHost) ||
    origin.endsWith('.vercel.app');
  if (!isAllowed) return new NextResponse('Forbidden origin', { status: 403 });

  const auth = req.headers.get('authorization') || '';
  const token = auth.startsWith('Bearer ') ? auth.slice(7) : null;
  if (!token) return new NextResponse('Missing auth', { status: 401 });

  const sb = getSupabaseServerAdmin();
  const { data: userData, error } = await sb.auth.getUser(token);
  if (error || !userData?.user) return new NextResponse('Invalid auth', { status: 401 });
  const userId = userData.user.id;

  await ensureEntitlements(userId, FREE_TRIAL_SECONDS);
  const ent = await getEntitlement(userId);
  const secondsRemaining = await getDailySecondsRemaining(userId);

  return NextResponse.json(
    {
      token: randomUUID(),
      plan: ent.plan,
      status: ent.status,
  secondsRemaining,           // daily remaining
  trialPerDay: FREE_TRIAL_SECONDS,
  paywallRequired: secondsRemaining <= 0 && ent.status !== 'active'
    },
    { headers: { 'Access-Control-Allow-Origin': origin } }
  );
}
