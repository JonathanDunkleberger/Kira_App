import { NextRequest, NextResponse } from 'next/server';
import Stripe from 'stripe';
import { envServer as env } from '@/lib/server/env.server';
import { getSupabaseServerAdmin } from '@/lib/server/supabaseAdmin';

export const runtime = 'nodejs';

export async function POST(req: NextRequest) {
  try {
    const auth = req.headers.get('authorization') || '';
    const token = auth.startsWith('Bearer ') ? auth.slice(7) : null;
    if (!token) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

    const sb = getSupabaseServerAdmin();
    const { data: userData, error } = await sb.auth.getUser(token);
    if (error || !userData?.user)
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

    const userId = userData.user.id;
    const { data: ent } = await sb
      .from('entitlements')
      .select('stripe_customer_id')
      .eq('user_id', userId)
      .maybeSingle();
    let stripeCustomerId = (ent?.stripe_customer_id as string) || undefined;

    const stripe = new Stripe(env.STRIPE_SECRET_KEY, { apiVersion: '2024-06-20' });

    // If we don't have a stored Stripe customer, try to find by email and persist for next time
    if (!stripeCustomerId) {
      const email = userData.user.email;
      if (!email)
        return NextResponse.json(
          { error: 'No email on account. Please contact support.' },
          { status: 400 },
        );
      const customers = await stripe.customers.list({ email, limit: 1 });
      const customer = customers.data[0];
      if (!customer) {
        return NextResponse.json(
          { error: 'No Stripe customer found for your email. Please start a subscription first.' },
          { status: 400 },
        );
      }
      stripeCustomerId = customer.id;
      await sb
        .from('entitlements')
        .upsert(
          { user_id: userId, stripe_customer_id: stripeCustomerId },
          { onConflict: 'user_id' },
        );
    }

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
