import { NextRequest, NextResponse } from 'next/server';
import Stripe from 'stripe';
import { envServer as env } from '@/lib/env.server';
import { getSupabaseServerAdmin } from '@/lib/supabaseAdmin';

export const runtime = 'nodejs';
const stripe = new Stripe(env.STRIPE_SECRET_KEY, { apiVersion: '2024-06-20' });

export async function POST(req: NextRequest) {
  try {
    const auth = req.headers.get('authorization') || '';
    const token = auth.startsWith('Bearer ') ? auth.slice(7) : null;
    if (!token) return new NextResponse('Missing auth', { status: 401 });

    const sb = getSupabaseServerAdmin();
    const { data: userData, error } = await sb.auth.getUser(token);
    if (error || !userData?.user) return new NextResponse('Invalid auth', { status: 401 });

    const userId = userData.user.id;
    const email = userData.user.email || undefined;

    // Look up any existing Stripe customer id for this user
    const { data: ent } = await sb
      .from('entitlements')
      .select('stripe_customer_id')
      .eq('user_id', userId)
      .maybeSingle();

    // This now correctly handles null, undefined, AND empty strings
    let stripeCustomerId = ent?.stripe_customer_id || null;

    // Create a Stripe customer once and persist it
    if (!stripeCustomerId) {
      const customer = await stripe.customers.create({
        email, // may be undefined for anonymous, that's OK
        metadata: { user_id: userId },
      });
      stripeCustomerId = customer.id;

      await sb.from('entitlements').upsert({
        user_id: userId,
        plan: 'free',
        status: 'inactive',
        stripe_customer_id: stripeCustomerId,
      });
    }

    const session = await stripe.checkout.sessions.create({
      mode: 'subscription',
      line_items: [{ price: env.STRIPE_PRICE_ID, quantity: 1 }],
      success_url: `${env.APP_URL}/?success=1&session_id={CHECKOUT_SESSION_ID}`,
      cancel_url: `${env.APP_URL}/?canceled=1`,
      customer: stripeCustomerId!,
      metadata: { userId },
    });

    return NextResponse.json({ url: session.url });
  } catch (error: any) {
    console.error('Stripe Create Checkout Error:', error);
    return NextResponse.json(
      { error: error?.message || 'Failed to create checkout session.' },
      { status: 500 }
    );
  }
}