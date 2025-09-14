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
  const sub = await prisma.subscription.findFirst({ where: { userId, stripeCustomer: { not: null } } });
  if (!sub?.stripeCustomer) return NextResponse.json({ error: 'No subscription' }, { status: 400 });

  const stripe = getStripe();
  const portalSession = await stripe.billingPortal.sessions.create({
    customer: sub.stripeCustomer,
    return_url: `${envServer.APP_URL}/account/billing`,
  });

  return NextResponse.json({ url: portalSession.url });
}
