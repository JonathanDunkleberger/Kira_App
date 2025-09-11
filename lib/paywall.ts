import { NextResponse } from 'next/server';

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

  // Placeholder logic: free users always have remaining time (not enforced server-side).
  // Future: integrate with persistent usage + subscription records.
  return;
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
