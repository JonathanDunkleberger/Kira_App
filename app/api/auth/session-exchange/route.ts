import { NextRequest, NextResponse } from 'next/server';
export const runtime = 'nodejs';

export async function POST(req: NextRequest) {
  try {
    const { session_id } = await req.json();
    if (!session_id || typeof session_id !== 'string') {
      return NextResponse.json({ error: 'Missing session_id' }, { status: 400 });
    }

    // Lazy import Stripe
    const { default: Stripe } = await import('stripe');
    const STRIPE_SECRET_KEY = process.env.STRIPE_SECRET_KEY;
    if (!STRIPE_SECRET_KEY)
      return NextResponse.json({ error: 'Stripe not configured' }, { status: 500 });
    const stripe = new Stripe(STRIPE_SECRET_KEY, { apiVersion: '2024-06-20' });

    // Retrieve checkout session
    const checkout = await stripe.checkout.sessions.retrieve(session_id);
    if (checkout.status !== 'complete') {
      return NextResponse.json({ error: 'Checkout not complete' }, { status: 400 });
    }

    // Derive user identity
    const userId = checkout.client_reference_id || (checkout.metadata as any)?.userId;
    const customerId = typeof checkout.customer === 'string' ? checkout.customer : undefined;
    if (!userId) {
      return NextResponse.json({ error: 'Missing user id on session' }, { status: 400 });
    }

    // Supabase removed: return stub tokens (NOT FOR PRODUCTION)
    return NextResponse.json({ access_token: 'stub-access', refresh_token: 'stub-refresh' });
  } catch (err: any) {
    return NextResponse.json({ error: err?.message || 'Unexpected error' }, { status: 500 });
  }
}
