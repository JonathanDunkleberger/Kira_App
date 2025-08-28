import { NextRequest, NextResponse } from 'next/server';
import { env } from '@/lib/env';
import { getSupabaseServerAdmin } from '@/lib/supabaseAdmin';

export const runtime = 'nodejs';

export async function POST(req: NextRequest) {
  const auth = req.headers.get('authorization') || '';
  const token = auth.startsWith('Bearer ') ? auth.slice(7) : null;
  if (!token) return new NextResponse('Missing auth', { status: 401 });

  const sb = getSupabaseServerAdmin();
  const { data: userData, error } = await sb.auth.getUser(token);
  if (error || !userData.user) return new NextResponse('Invalid auth', { status: 401 });
  const userId = userData.user.id;

  // Lazy load Stripe SDK
  const { default: Stripe } = await import('stripe');
  const stripe = new Stripe(env.STRIPE_SECRET_KEY, { apiVersion: '2024-06-20' });

  const session = await stripe.checkout.sessions.create({
    mode: 'subscription',
    line_items: [{ price: env.STRIPE_PRICE_ID, quantity: 1 }],
    success_url: `${env.APP_URL}/?success=1`,
    cancel_url: `${env.APP_URL}/?canceled=1`,
    metadata: { userId },
    // This tells Stripe to create a customer and prompt for an email
    customer_creation: 'always', 
  });

  return NextResponse.json({ url: session.url });
}