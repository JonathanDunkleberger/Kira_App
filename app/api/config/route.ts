import { NextResponse } from 'next/server';
import { FREE_TRIAL_SECONDS } from '@/lib/env';

export const runtime = 'edge';

export async function GET() {
  return NextResponse.json({ freeTrialSeconds: FREE_TRIAL_SECONDS });
}
