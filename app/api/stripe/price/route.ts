import { NextResponse } from 'next/server';
import Stripe from 'stripe';
import { envServer as env } from '@/lib/server/env.server';

export const runtime = 'edge';

const stripe = new Stripe(env.STRIPE_SECRET_KEY, {
  apiVersion: '2024-06-20',
});

export async function GET() {
  try {
    const priceId = env.STRIPE_PRICE_ID;
    if (!priceId) {
      throw new Error('STRIPE_PRICE_ID is not set.');
    }

    const price = await stripe.prices.retrieve(priceId);

    const amount = (price.unit_amount || 0) / 100;
    const interval = price.recurring?.interval || 'month';
    const displayPrice = `$${amount.toFixed(2)}/${interval === 'month' ? 'mo' : interval}`;

    return NextResponse.json({ displayPrice });
  } catch (error: any) {
    console.error('Stripe price fetch error:', error);
    return NextResponse.json({ error: 'Could not fetch price information.' }, { status: 500 });
  }
}
