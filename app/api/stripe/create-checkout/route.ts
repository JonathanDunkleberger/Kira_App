import { NextRequest, NextResponse } from 'next/server';
// Defer env reads to request-time
import { getSupabaseServerAdmin } from '@/lib/supabaseAdmin';

export const runtime = 'nodejs';

export async function POST(req: NextRequest) {
  // Accept explicit userId for fresh sign-ups from the CheckoutModal; fallback to auth token
  const body = await req.json().catch(() => ({} as any));
  let userId: string | null = typeof body?.userId === 'string' ? body.userId : null;
  if (!userId) {
    const auth = req.headers.get('authorization') || '';
    const token = auth.startsWith('Bearer ') ? auth.slice(7) : null;
    if (!token) return new NextResponse('Missing auth', { status: 401 });
    const sb = getSupabaseServerAdmin();
    const { data: userData, error } = await sb.auth.getUser(token);
    if (error || !userData.user) return new NextResponse('Invalid auth', { status: 401 });
    userId = userData.user.id;
  }

  // Lazy load Stripe SDK
  const { default: Stripe } = await import('stripe');
  const STRIPE_SECRET_KEY = process.env.STRIPE_SECRET_KEY || '';
  const STRIPE_PRICE_ID = process.env.STRIPE_PRICE_ID || '';
  const APP_URL = process.env.APP_URL || '';
  const stripe = new Stripe(STRIPE_SECRET_KEY, { apiVersion: '2024-06-20' });
  const sb = getSupabaseServerAdmin();

  // Lookup or create a Stripe customer and persist it
  let customerId: string | undefined;
  // Try to read from profiles
  const { data: profile } = await sb.from('profiles').select('stripe_customer_id').eq('user_id', userId).maybeSingle();
  if (profile?.stripe_customer_id) {
    customerId = profile.stripe_customer_id as string;
  } else {
    // Fetch user email to create a Stripe customer
    const { data: userData } = await sb.auth.admin.getUserById(userId);
    const email = userData?.user?.email || undefined;
    const customer = await stripe.customers.create({ email });
    customerId = customer.id;
    await sb.from('profiles').upsert({ user_id: userId, stripe_customer_id: customerId });
  }

  const session = await stripe.checkout.sessions.create({
    mode: 'subscription',
  line_items: [{ price: STRIPE_PRICE_ID, quantity: 1 }],
  success_url: `${APP_URL}/?success=1`,
  cancel_url: `${APP_URL}/?canceled=1`,
    metadata: { userId },
    client_reference_id: userId || undefined,
    customer: customerId,
  });

  return NextResponse.json({ url: session.url });
}