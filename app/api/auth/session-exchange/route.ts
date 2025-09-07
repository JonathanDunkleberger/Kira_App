import { NextRequest, NextResponse } from 'next/server';
import { createClient as createSupabaseClient } from '@supabase/supabase-js';
export const runtime = 'nodejs';

export async function POST(req: NextRequest) {
  try {
    const { session_id } = await req.json();
    if (!session_id || typeof session_id !== 'string') {
      return NextResponse.json({ error: 'Missing session_id' }, { status: 400 });
    }

    // Lazy import Stripe
    const { default: Stripe } = await import('stripe');
    const STRIPE_SECRET_KEY = process.env.STRIPE_SECRET_KEY;
    if (!STRIPE_SECRET_KEY)
      return NextResponse.json({ error: 'Stripe not configured' }, { status: 500 });
    const stripe = new Stripe(STRIPE_SECRET_KEY, { apiVersion: '2024-06-20' });

    // Retrieve checkout session
    const checkout = await stripe.checkout.sessions.retrieve(session_id);
    if (checkout.status !== 'complete') {
      return NextResponse.json({ error: 'Checkout not complete' }, { status: 400 });
    }

    // Derive user identity
    const userId = checkout.client_reference_id || (checkout.metadata as any)?.userId;
    const customerId = typeof checkout.customer === 'string' ? checkout.customer : undefined;
    if (!userId) {
      return NextResponse.json({ error: 'Missing user id on session' }, { status: 400 });
    }

    // Create Supabase session for this user via Admin API
    const { getSupabaseServerAdmin } = await import('@/lib/server/supabaseAdmin');
    const sbAdmin = getSupabaseServerAdmin();

    // Look up user email
    const { data: userRes, error: userErr } = await sbAdmin.auth.admin.getUserById(userId);
    if (userErr || !userRes?.user) {
      return NextResponse.json({ error: 'User not found' }, { status: 404 });
    }
    const email = userRes.user.email;
    if (!email) return NextResponse.json({ error: 'User email missing' }, { status: 400 });

    // Generate a magic link to obtain an OTP we can verify server-side to mint a session
    const { data: linkData, error: linkErr } = await sbAdmin.auth.admin.generateLink({
      type: 'magiclink',
      email,
      options: { redirectTo: (process.env.APP_URL || '') + '/auth/callback' },
    });
    if (linkErr || !linkData) {
      return NextResponse.json(
        { error: linkErr?.message || 'Failed to generate link' },
        { status: 500 },
      );
    }

    const email_otp = (linkData as any).email_otp as string | undefined;
    if (!email_otp) {
      return NextResponse.json({ error: 'OTP not available from generateLink' }, { status: 500 });
    }

    // Verify OTP using an anon Supabase client to get a real session (tokens)
    const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL || '';
    const supabaseAnonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY || '';
    if (!supabaseUrl || !supabaseAnonKey) {
      return NextResponse.json({ error: 'Supabase client not configured' }, { status: 500 });
    }
    const sbAnon = createSupabaseClient(supabaseUrl, supabaseAnonKey, {
      auth: { persistSession: false, autoRefreshToken: false },
    });

    const { data: verifyData, error: verifyErr } = await sbAnon.auth.verifyOtp({
      email,
      token: email_otp,
      type: 'magiclink',
    });
    if (verifyErr || !verifyData?.session) {
      return NextResponse.json(
        { error: verifyErr?.message || 'Failed to verify OTP' },
        { status: 500 },
      );
    }

    const { access_token, refresh_token } = verifyData.session;

    // Persist stripe customer id for future portal access if present
    if (customerId) {
      await sbAdmin.from('profiles').upsert({ user_id: userId, stripe_customer_id: customerId });
    }

    return NextResponse.json({ access_token, refresh_token });
  } catch (err: any) {
    return NextResponse.json({ error: err?.message || 'Unexpected error' }, { status: 500 });
  }
}
