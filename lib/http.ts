import { NextResponse } from 'next/server';

// Standardized paywall response with a JSON body and X-Paywall-Required header
export function createPaywallResponse(body: any = {
  error: 'Daily time limit exceeded. Please upgrade to continue.'
}) {
  return NextResponse.json(body, {
    status: 402,
    headers: { 'X-Paywall-Required': 'true' }
  });
}
