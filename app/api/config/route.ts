import { NextResponse } from 'next/server';
import { FREE_TRIAL_SECONDS, PRO_SESSION_SECONDS } from '@/lib/env.server';

export const runtime = 'edge';

export async function GET() {
  return NextResponse.json({
    freeTrialSeconds: FREE_TRIAL_SECONDS,
    proSessionSeconds: PRO_SESSION_SECONDS,
  });
}
