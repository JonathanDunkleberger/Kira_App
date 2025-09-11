import { NextRequest, NextResponse } from 'next/server';
import Stripe from 'stripe';

import { envServer as env } from '@/lib/server/env.server';

export const runtime = 'nodejs';

const stripe = new Stripe(env.STRIPE_SECRET_KEY, { apiVersion: '2024-06-20' });

export async function POST(req: NextRequest) {
  const sig = req.headers.get('stripe-signature')!;
  const buf = Buffer.from(await req.arrayBuffer());
  const whSecret = env.STRIPE_WEBHOOK_SECRET;
  if (!whSecret) {
    return new NextResponse('Webhook not configured', { status: 500 });
  }

  let event: Stripe.Event;
  try {
    event = stripe.webhooks.constructEvent(buf, sig, whSecret);
  } catch (err: any) {
    return new NextResponse(`Webhook Error: ${err.message}`, { status: 400 });
  }

  // Supabase removed: skip persistence updates.
  async function activatePro(_userId?: string, _customerId?: string | null, _subscriptionId?: string | null) { /* no-op */ }
  async function updateStatusByCustomer(_customerId?: string, _status?: string, _subscriptionId?: string) { /* no-op */ }
  async function updateStatusBySubscription(_subscriptionId?: string, _status?: string, _customerId?: string) { /* no-op */ }

  switch (event.type) {
    case 'checkout.session.completed': {
      const s = event.data.object as Stripe.Checkout.Session;
      const userId = (s.metadata as any)?.userId as string | undefined;
      const customerId = (s.customer as string) || undefined;
      const subscriptionId = (s.subscription as string) || undefined;

      if (userId) {
        await activatePro(userId, customerId, subscriptionId);
        // Track successful upgrade
        try {
          await fetch(`${env.APP_URL}/api/analytics/paywall`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              event: 'paywall_upgrade_success',
              properties: {
                userId,
                userType: 'authenticated',
                plan: 'pro',
                stripeCustomerId: customerId,
                stripeSubscriptionId: subscriptionId,
              },
              timestamp: new Date().toISOString(),
            }),
          });
        } catch {}
      } else if (customerId) {
        await updateStatusByCustomer(customerId, 'active', subscriptionId);
      }
      break;
    }

    case 'customer.subscription.created':
    case 'customer.subscription.updated': {
      const sub = event.data.object as Stripe.Subscription;
      const status =
        sub.status === 'active' ? 'active' : sub.status === 'past_due' ? 'past_due' : 'canceled';
      await updateStatusBySubscription(sub.id, status, sub.customer as string);
      break;
    }

    case 'customer.subscription.deleted': {
      const sub = event.data.object as Stripe.Subscription;
      await updateStatusBySubscription(sub.id, 'canceled', sub.customer as string);
      break;
    }
  }

  return NextResponse.json({ received: true });
}
