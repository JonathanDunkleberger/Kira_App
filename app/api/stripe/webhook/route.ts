import { NextRequest, NextResponse } from 'next/server';
import Stripe from 'stripe';
import { env } from '@/lib/env';
import { addSupporter } from '@/lib/usage';

export const runtime = 'nodejs';

export async function POST(req: NextRequest) {
  const sig = req.headers.get('stripe-signature')!;
  const buf = Buffer.from(await req.arrayBuffer());

  let event: Stripe.Event;
  try {
    event = new Stripe(env.STRIPE_SECRET_KEY, { apiVersion: '2024-06-20' })
      .webhooks.constructEvent(buf, sig, env.STRIPE_WEBHOOK_SECRET);
  } catch (err: any) {
    return new NextResponse(`Webhook Error: ${err.message}`, { status: 400 });
  }

  if (event.type === 'checkout.session.completed') {
    const session = event.data.object as Stripe.Checkout.Session;
    const userId = session.metadata?.userId || '';
    if (userId) await addSupporter(userId, 1000); // grant 1000 minutes
  }

  return NextResponse.json({ received: true });
}
