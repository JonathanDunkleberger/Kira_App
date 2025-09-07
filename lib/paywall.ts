import { NextResponse } from 'next/server';

import { getSupabaseServerAdmin } from '@/lib/server/supabaseAdmin';
import { FREE_TRIAL_SECONDS } from '@/lib/server/env.server';

export class PaywallError extends Error {
  constructor(
    message: string,
    public code: number = 402,
  ) {
    super(message);
    this.name = 'PaywallError';
  }
}

// Server-side enforcement only (no localStorage on server)
export async function enforcePaywall(userId: string | null): Promise<void> {
  if (!userId) return; // guests enforced client-side

  const sb = getSupabaseServerAdmin();
  const { data: ent, error } = await sb
    .from('entitlements')
    .select('status, trial_seconds_remaining, plan')
    .eq('user_id', userId)
    .maybeSingle();

  if (error) throw error;

  if (!ent) {
    // Seed default entitlement
    await sb.from('entitlements').insert({
      user_id: userId,
      plan: 'free',
      status: 'inactive',
      trial_seconds_per_day: FREE_TRIAL_SECONDS,
      trial_last_reset: new Date().toISOString().slice(0, 10),
      trial_seconds_remaining: FREE_TRIAL_SECONDS,
    });
    return;
  }

  const isActive = ent.status === 'active';
  const seconds = ent.trial_seconds_remaining || 0;
  if (!isActive && seconds <= 0) {
    throw new PaywallError('Daily time limit exceeded');
  }
}

export function createPaywallResponse(message: string = 'Daily time limit exceeded') {
  return NextResponse.json(
    { error: message, code: 'PAYWALL_REQUIRED' },
    { status: 402, headers: { 'X-Paywall-Required': 'true' } },
  );
}

export function shouldTriggerPaywall(error: any): boolean {
  try {
    if (error instanceof PaywallError) return true;
  } catch {}
  return (
    error?.status === 402 ||
    error?.code === 'PAYWALL_REQUIRED' ||
    (typeof error?.headers?.get === 'function' &&
      error.headers.get('X-Paywall-Required') === 'true')
  );
}
