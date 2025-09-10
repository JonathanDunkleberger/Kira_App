import { NextRequest, NextResponse } from 'next/server';
import { currentUser } from '@clerk/nextjs/server';
import Stripe from 'stripe';

import { envServer as env } from '@/lib/server/env.server';
import { getSupabaseServerAdmin } from '@/lib/server/supabaseAdmin';

export const runtime = 'nodejs';
const stripe = new Stripe(env.STRIPE_SECRET_KEY, { apiVersion: '2024-06-20' });

export async function POST(req: NextRequest) {
  try {
  const cu = await currentUser();
  if (!cu) return new NextResponse('Unauthorized', { status: 401 });

  const userId = cu.id;
  const email = cu.emailAddresses?.[0]?.emailAddress || undefined;

  const sb = getSupabaseServerAdmin();

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
      success_url: `${env.APP_URL}/?success=1`,
      cancel_url: `${env.APP_URL}/?canceled=1`,
      customer: stripeCustomerId!,
      metadata: { userId },
    });

    return NextResponse.json({ url: session.url });
  } catch (error: any) {
    console.error('Stripe Create Checkout Error:', error);
    return NextResponse.json(
      { error: error?.message || 'Failed to create checkout session.' },
      { status: 500 },
    );
  }
}
