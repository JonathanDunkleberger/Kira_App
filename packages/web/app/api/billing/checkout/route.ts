import { NextResponse } from 'next/server';
import { auth } from '@clerk/nextjs/server';
import { envServer } from '../../../../lib/env.server';
import { getStripe } from '../../../../lib/server/stripe';
import { prisma } from '../../../../lib/server/prisma';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function POST() {
  const { userId } = await auth();
  if (!userId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const user = await prisma.user.findUnique({ where: { id: userId }, include: { subscriptions: true } });
  if (!user) return NextResponse.json({ error: 'User not found' }, { status: 404 });

  // If already active subscription, redirect to portal instead
  if (user.subscriptions.some((s) => ['active', 'trialing', 'past_due'].includes(s.status))) {
    return NextResponse.json({ alreadySubscribed: true }, { status: 400 });
  }

  const stripe = getStripe();
  const session = await stripe.checkout.sessions.create({
    mode: 'subscription',
    line_items: [
      {
        price: envServer.STRIPE_PRICE_ID,
        quantity: 1,
      },
    ],
    success_url: `${envServer.APP_URL}/success?session_id={CHECKOUT_SESSION_ID}`,
    cancel_url: `${envServer.APP_URL}/account/billing?canceled=1`,
    metadata: { userId },
    allow_promotion_codes: true,
  });

  return NextResponse.json({ url: session.url });
}
