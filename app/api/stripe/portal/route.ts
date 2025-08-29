import { NextRequest, NextResponse } from 'next/server';
import { env } from '@/lib/env';
import Stripe from 'stripe';
import { getSupabaseServerAdmin } from '@/lib/supabaseAdmin';

export const runtime = 'nodejs';

export async function POST(req: NextRequest) {
  const auth = req.headers.get('authorization') || '';
  const token = auth.startsWith('Bearer ') ? auth.slice(7) : null;
  if (!token) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const sb = getSupabaseServerAdmin();
  const { data: userData, error } = await sb.auth.getUser(token);
  if (error || !userData?.user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const userId = userData.user.id;
  const { data: ent } = await sb.from('entitlements').select('stripe_customer_id').eq('user_id', userId).maybeSingle();
  const stripeCustomerId = ent?.stripe_customer_id as string | undefined;
  if (!stripeCustomerId) return NextResponse.json({ error: 'No Stripe customer' }, { status: 400 });

  const stripe = new Stripe(env.STRIPE_SECRET_KEY, { apiVersion: '2024-06-20' });
  const session = await stripe.billingPortal.sessions.create({
    customer: stripeCustomerId,
    return_url: `${env.APP_URL}/account`,
  });

  return NextResponse.json({ url: session.url });
}
