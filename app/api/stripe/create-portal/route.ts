import { NextRequest, NextResponse } from 'next/server';
import { getSupabaseServerAdmin } from '@/lib/supabaseAdmin';

export const runtime = 'nodejs';

export async function POST(req: NextRequest) {
  try {
    const auth = req.headers.get('authorization') || '';
    const token = auth.startsWith('Bearer ') ? auth.slice(7) : null;
    if (!token) return new NextResponse('Missing auth', { status: 401 });

    const sb = getSupabaseServerAdmin();
    const { data: userData, error } = await sb.auth.getUser(token);
    if (error || !userData.user) return new NextResponse('Invalid auth', { status: 401 });
    const email = userData.user.email;
    if (!email) return new NextResponse('Email required', { status: 400 });

    const APP_URL = process.env.APP_URL || '';
    const STRIPE_SECRET_KEY = process.env.STRIPE_SECRET_KEY || '';
    const { default: Stripe } = await import('stripe');
    const stripe = new Stripe(STRIPE_SECRET_KEY, { apiVersion: '2024-06-20' });

    // Find the Stripe customer by email
    const customers = await stripe.customers.search({ query: `email:'${email.replace(/'/g, " ")}'` });
    const customer = customers.data[0];
    if (!customer) {
      return NextResponse.json({ error: 'No customer found' }, { status: 404 });
    }

    const portal = await stripe.billingPortal.sessions.create({
      customer: customer.id,
      return_url: APP_URL || 'https://vercel.com',
    });
    return NextResponse.json({ url: portal.url });
  } catch (e: any) {
    console.error('create-portal error:', e);
    return NextResponse.json({ error: 'Server error' }, { status: 500 });
  }
}
