import { NextRequest, NextResponse } from 'next/server';
import { randomUUID } from 'crypto';
import { envServer as env, FREE_TRIAL_SECONDS, PRO_SESSION_SECONDS } from '@/lib/server/env.server';
import { getSupabaseServerAdmin } from '@/lib/server/supabaseAdmin';
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

  // Guest support: allow unauthenticated access with guestId query param
  if (!token) {
    const url = new URL(req.url);
    const guestId = url.searchParams.get('guestId');
    if (!guestId) {
      const payload = {
        status: 'inactive',
        plan: 'free',
        secondsRemaining: FREE_TRIAL_SECONDS,
        dailyLimitSeconds: FREE_TRIAL_SECONDS,
        trialPerDay: FREE_TRIAL_SECONDS,
        proSessionLimit: PRO_SESSION_SECONDS,
      } as const;
      try { console.log(`[Entitlement Check] User: guest | Status: Guest | Limit Sent (s): ${payload.dailyLimitSeconds}`); } catch {}
      return NextResponse.json(payload, { headers: { 'Access-Control-Allow-Origin': origin } });
    }
    // Try to read server-side guest conversation remaining seconds
    try {
      const sb = getSupabaseServerAdmin();
      const { data } = await sb.from('conversations').select('seconds_remaining').eq('id', guestId).maybeSingle();
      const secondsRemaining = Number(data?.seconds_remaining ?? FREE_TRIAL_SECONDS);
      const payload = {
        status: 'inactive',
        plan: 'free',
        secondsRemaining,
        dailyLimitSeconds: FREE_TRIAL_SECONDS,
        trialPerDay: FREE_TRIAL_SECONDS,
        proSessionLimit: PRO_SESSION_SECONDS,
      } as const;
      try { console.log(`[Entitlement Check] User: guest-id-${guestId} | Status: Guest | Limit Sent (s): ${payload.dailyLimitSeconds}`); } catch {}
      return NextResponse.json(payload, { headers: { 'Access-Control-Allow-Origin': origin } });
    } catch {
      const payload = {
        status: 'inactive',
        plan: 'free',
        secondsRemaining: FREE_TRIAL_SECONDS,
        dailyLimitSeconds: FREE_TRIAL_SECONDS,
        trialPerDay: FREE_TRIAL_SECONDS,
        proSessionLimit: PRO_SESSION_SECONDS,
      } as const;
      try { console.log(`[Entitlement Check] User: guest | Status: Guest | Limit Sent (s): ${payload.dailyLimitSeconds}`); } catch {}
      return NextResponse.json(payload, { headers: { 'Access-Control-Allow-Origin': origin } });
    }
  }

  const sb = getSupabaseServerAdmin();
  const { data: userData, error } = await sb.auth.getUser(token);
  if (error || !userData?.user) return new NextResponse('Invalid auth', { status: 401 });
  const userId = userData.user.id;

  await ensureEntitlements(userId, FREE_TRIAL_SECONDS);
  const ent = await getEntitlement(userId);
  const secondsRemaining = await getDailySecondsRemaining(userId);

  const isPro = ent.status === 'active';
  const payload = {
    token: randomUUID(),
    plan: ent.plan,
    status: ent.status,
    secondsRemaining,           // daily remaining
    dailyLimitSeconds: isPro ? Number.POSITIVE_INFINITY : FREE_TRIAL_SECONDS,
    trialPerDay: FREE_TRIAL_SECONDS,
    proSessionLimit: PRO_SESSION_SECONDS,
    paywallRequired: secondsRemaining <= 0 && !isPro,
  } as const;
  try { console.log(`[Entitlement Check] User: ${userId} | Status: ${isPro ? 'Pro' : 'Registered Free'} | Limit Sent (s): ${isPro ? 'Infinity' : payload.dailyLimitSeconds}`); } catch {}
  return NextResponse.json(payload, { headers: { 'Access-Control-Allow-Origin': origin } });
}
