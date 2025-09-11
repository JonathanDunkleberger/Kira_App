import { NextRequest, NextResponse } from 'next/server';
import { currentUser } from '@clerk/nextjs/server';
import Stripe from 'stripe';

import { envServer as env } from '@/lib/server/env.server';

export const runtime = 'nodejs';

export async function POST(req: NextRequest) {
  try {
    const cu = await currentUser();
    if (!cu) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

    const userId = cu.id;
    const stripe = new Stripe(env.STRIPE_SECRET_KEY, { apiVersion: '2024-06-20' });
    // Supabase removed: always create/find ephemeral customer via email
    const email = cu.emailAddresses?.[0]?.emailAddress;
    if (!email)
      return NextResponse.json(
        { error: 'No email on account. Please contact support.' },
        { status: 400 },
      );
    const customers = await stripe.customers.list({ email, limit: 1 });
    const customer = customers.data[0] || (await stripe.customers.create({ email, metadata: { user_id: userId } }));
    const stripeCustomerId = customer.id;

    const session = await stripe.billingPortal.sessions.create({
      customer: stripeCustomerId,
      return_url: `${env.APP_URL}/account`,
    });

    return NextResponse.json({ url: session.url });
  } catch (err: any) {
    console.error('Stripe Portal Error:', err);
    const message = err?.message || 'An unexpected error occurred.';
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
