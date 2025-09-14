import { NextRequest, NextResponse } from 'next/server';

import { envServer } from '../../../../lib/env.server';
import { getStripe } from '../../../../lib/server/stripe';
import { prisma } from '../../../../lib/server/prisma';

// Helper to extract user id from metadata (set during Checkout creation)
function userIdFromObject(obj: any): string | null {
  return obj?.metadata?.userId || null;
}

async function recordPaymentEvent(params: {
  userId: string;
  stripeId: string;
  type: string;
  status?: string | null;
  amountCents?: number | null;
  currency?: string | null;
  raw: any;
}) {
  const { userId, stripeId, type, status, amountCents, currency, raw } = params;
  try {
    await prisma.paymentEvent.upsert({
      where: { stripeId },
      update: { type, status: status || undefined, amountCents: amountCents || undefined, currency: currency || undefined, raw },
      create: { userId, stripeId, type, status: status || undefined, amountCents: amountCents || undefined, currency: currency || undefined, raw },
    });
  } catch (e) {
    // swallow to avoid webhook retries storm; could add logging
  }
}

async function syncSubscription(stripeSub: any, eventType: string) {
  const stripeSubId = stripeSub.id as string;
  const userId = userIdFromObject(stripeSub) || userIdFromObject(stripeSub.customer_object) || userIdFromObject(stripeSub.latest_invoice?.customer) || null;
  // Fallback: we may have saved an existing subscription with this stripeSubId and can recover userId
  let existing = await prisma.subscription.findFirst({ where: { stripeSubId } });
  const resolvedUserId = userId || existing?.userId;
  if (!resolvedUserId) return; // cannot proceed without owning user

  const status = stripeSub.status as string;
  const plan = (stripeSub.items?.data?.[0]?.price?.nickname || stripeSub.items?.data?.[0]?.price?.id || 'pro') as string;
  const currentPeriodEnd = stripeSub.current_period_end ? new Date(stripeSub.current_period_end * 1000) : null;
  const cancelAt = stripeSub.cancel_at ? new Date(stripeSub.cancel_at * 1000) : null;
  const canceledAt = stripeSub.canceled_at ? new Date(stripeSub.canceled_at * 1000) : null;
  const stripeCustomer = typeof stripeSub.customer === 'string' ? stripeSub.customer : stripeSub.customer?.id;

  if (eventType === 'customer.subscription.deleted') {
    // Mark subscription inactive instead of deleting for history
    if (existing) {
      await prisma.subscription.update({
        where: { id: existing.id },
        data: { status: 'canceled', canceledAt: new Date(), cancelAt },
      });
    }
    return;
  }

  await prisma.subscription.upsert({
    where: { stripeSubId },
    update: { userId: resolvedUserId, status, plan, currentPeriodEnd: currentPeriodEnd || undefined, cancelAt: cancelAt || undefined, canceledAt: canceledAt || undefined, stripeCustomer },
    create: { userId: resolvedUserId, status, plan, currentPeriodEnd: currentPeriodEnd || undefined, cancelAt: cancelAt || undefined, canceledAt: canceledAt || undefined, stripeSubId, stripeCustomer },
  });

  // Optionally elevate user tier based on plan & active status
  if (status === 'active' || status === 'trialing') {
    await prisma.user.update({ where: { id: resolvedUserId }, data: { tier: 'pro' } });
  } else if (['canceled', 'unpaid', 'incomplete_expired', 'past_due'].includes(status)) {
    // In a real system consider grace period; immediate downgrade here
    await prisma.user.update({ where: { id: resolvedUserId }, data: { tier: 'free' } });
  }
}

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

// Stripe sends raw body. Disable Next's default parsing by reading as arrayBuffer.
export async function POST(req: NextRequest) {
  const stripe = getStripe();

  const sig = req.headers.get('stripe-signature');
  if (!sig) return NextResponse.json({ error: 'Missing signature' }, { status: 400 });
  if (!envServer.STRIPE_WEBHOOK_SECRET) {
    return NextResponse.json({ error: 'Webhook secret not configured' }, { status: 500 });
  }

  let event: any;
  try {
    const raw = await req.arrayBuffer();
    event = stripe.webhooks.constructEvent(Buffer.from(raw), sig, envServer.STRIPE_WEBHOOK_SECRET);
  } catch (e: any) {
    return NextResponse.json({ error: 'Invalid signature', details: e.message }, { status: 400 });
  }

  try {
    switch (event.type) {
      case 'checkout.session.completed': {
        const session = event.data.object;
        const userId = userIdFromObject(session);
        if (userId) {
          // Temporary elevate until subscription event lands
            await prisma.user.update({ where: { id: userId }, data: { tier: 'pro' } }).catch(() => {});
        }
        break;
      }
      case 'customer.subscription.created':
      case 'customer.subscription.updated':
      case 'customer.subscription.deleted': {
        const sub = event.data.object;
        await syncSubscription(sub, event.type);
        break;
      }
      case 'invoice.payment_failed': {
        const invoice = event.data.object;
        const userId = userIdFromObject(invoice) || userIdFromObject(invoice.customer);
        if (userId) {
          await recordPaymentEvent({
            userId,
            stripeId: invoice.id,
            type: event.type,
            status: invoice.status,
            amountCents: invoice.amount_due,
            currency: invoice.currency,
            raw: invoice,
          });
          // Downgrade immediately (could implement grace window instead)
          await prisma.user.update({ where: { id: userId }, data: { tier: 'free' } }).catch(() => {});
        }
        break;
      }
      case 'invoice.payment_succeeded': {
        const invoice = event.data.object;
        const userId = userIdFromObject(invoice) || userIdFromObject(invoice.customer);
        if (userId) {
          await recordPaymentEvent({
            userId,
            stripeId: invoice.id,
            type: event.type,
            status: invoice.status,
            amountCents: invoice.amount_paid,
            currency: invoice.currency,
            raw: invoice,
          });
        }
        break;
      }
      default: {
        // Ignore unhandled events silently
        break;
      }
    }
  } catch (err: any) {
    return NextResponse.json({ error: 'Handler failure', details: err.message }, { status: 500 });
  }

  return NextResponse.json({ received: true });
}
