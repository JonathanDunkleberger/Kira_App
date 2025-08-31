import { NextRequest, NextResponse } from 'next/server';
import Stripe from 'stripe';
import { env } from '@/lib/env';
import { getSupabaseServerAdmin } from '@/lib/supabaseAdmin';

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

  const sb = getSupabaseServerAdmin();

  async function activatePro(userId: string, customerId?: string | null, subscriptionId?: string | null) {
    await sb.from('entitlements').upsert({
      user_id: userId,
      plan: 'supporter',
      status: 'active',
      seconds_remaining: 999_999_999,
      stripe_customer_id: customerId ?? undefined,
      stripe_subscription_id: subscriptionId ?? undefined,
    });
  }

  async function updateStatusByCustomer(customerId: string, status: string, subscriptionId?: string) {
    const { data } = await sb
      .from('entitlements')
      .select('user_id')
      .eq('stripe_customer_id', customerId)
      .maybeSingle();

    if (data?.user_id) {
      await sb.from('entitlements').upsert({
        user_id: data.user_id,
        plan: 'supporter',
        status,
        stripe_customer_id: customerId,
        stripe_subscription_id: subscriptionId,
      });
    }
  }

  async function updateStatusBySubscription(subscriptionId: string, status: string, customerId?: string) {
    const { data } = await sb
      .from('entitlements')
      .select('user_id')
      .eq('stripe_subscription_id', subscriptionId)
      .maybeSingle();

    if (data?.user_id) {
      await sb.from('entitlements').upsert({
        user_id: data.user_id,
        plan: 'supporter',
        status,
        stripe_customer_id: customerId,
        stripe_subscription_id: subscriptionId,
      });
    }
  }

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
      const status = sub.status === 'active' ? 'active' : sub.status === 'past_due' ? 'past_due' : 'canceled';
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