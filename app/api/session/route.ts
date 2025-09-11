import { randomUUID } from 'crypto';

import { NextRequest, NextResponse } from 'next/server';

import {
  envServer as env,
  FREE_TRIAL_SECONDS,
  PRO_SESSION_SECONDS,
} from '../../../lib/server/env.server';
// Legacy entitlement helpers removed in usage migration.

export const runtime = 'nodejs';

export async function GET(req: NextRequest) {
  const origin = req.headers.get('origin') || env.APP_URL;
  const allowedHost = new URL(env.APP_URL).host;
  const isAllowed =
    origin === env.ALLOWED_ORIGIN || origin.includes(allowedHost) || origin.endsWith('.vercel.app');
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
      try {
        console.log(
          `[Entitlement Check] User: guest | Status: Guest | Limit Sent (s): ${payload.dailyLimitSeconds}`,
        );
      } catch {}
      return NextResponse.json(payload, { headers: { 'Access-Control-Allow-Origin': origin } });
    }
    // Guest conversation lookup removed with Supabase purge—send baseline values.
    const payload = {
      status: 'inactive',
      plan: 'free',
      secondsRemaining: FREE_TRIAL_SECONDS,
      dailyLimitSeconds: FREE_TRIAL_SECONDS,
      trialPerDay: FREE_TRIAL_SECONDS,
      proSessionLimit: PRO_SESSION_SECONDS,
    } as const;
    try {
      console.log(
        `[Entitlement Check] User: guest-id-${guestId} | Status: Guest | Limit Sent (s): ${payload.dailyLimitSeconds}`,
      );
    } catch {}
    return NextResponse.json(payload, { headers: { 'Access-Control-Allow-Origin': origin } });
  }

  // Supabase removed. TODO: validate Clerk auth token (or rely on middleware) in future.
  const userId = 'user';

  // TODO: replace with entitlements heartbeat lookup once implemented
  const isPro = false; // placeholder until new entitlements system
  const secondsRemaining = FREE_TRIAL_SECONDS; // temporary fallback
  const payload = {
    token: randomUUID(),
    plan: isPro ? 'supporter' : 'free',
    status: isPro ? 'active' : 'inactive',
    secondsRemaining,
    dailyLimitSeconds: isPro ? Number.POSITIVE_INFINITY : FREE_TRIAL_SECONDS,
    trialPerDay: FREE_TRIAL_SECONDS,
    proSessionLimit: PRO_SESSION_SECONDS,
    paywallRequired: secondsRemaining <= 0 && !isPro,
  } as const;
  try {
    console.log(
  `[Entitlement Check] User: ${userId} | Status: ${isPro ? 'Pro' : 'Registered Free'} | Limit Sent (s): ${isPro ? 'Infinity' : payload.dailyLimitSeconds}`,
    );
  } catch {}
  return NextResponse.json(payload, { headers: { 'Access-Control-Allow-Origin': origin } });
}
