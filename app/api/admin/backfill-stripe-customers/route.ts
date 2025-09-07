import { NextRequest, NextResponse } from 'next/server';
import { getSupabaseServerAdmin } from '@/lib/server/supabaseAdmin';

export const runtime = 'nodejs';

// One-off endpoint to backfill profiles.stripe_customer_id for existing supporters.
// Protected: requires an admin token via header X-Admin-Token matching env.ADMIN_TOKEN.
export async function POST(req: NextRequest) {
  const ADMIN_TOKEN = process.env.ADMIN_TOKEN || '';
  if (!ADMIN_TOKEN) return new NextResponse('Disabled', { status: 403 });
  const provided = req.headers.get('x-admin-token') || '';
  if (provided !== ADMIN_TOKEN) return new NextResponse('Forbidden', { status: 403 });

  const STRIPE_SECRET_KEY = process.env.STRIPE_SECRET_KEY || '';
  const { default: Stripe } = await import('stripe');
  const stripe = new Stripe(STRIPE_SECRET_KEY, { apiVersion: '2024-06-20' });
  const sb = getSupabaseServerAdmin();

  const { data: rows, error } = await sb.rpc('supporters_to_backfill');
  if (error) {
    console.error('RPC error:', error);
    return NextResponse.json({ error: 'RPC error', detail: error.message }, { status: 500 });
  }

  const results: Array<{
    user_id: string;
    email: string | null;
    customer_id?: string;
    status: string;
  }> = [];
  for (const row of rows as Array<{ user_id: string; email: string | null }>) {
    const email = (row.email || '').trim();
    if (!email) {
      results.push({ user_id: row.user_id, email: null, status: 'skip:no-email' });
      continue;
    }
    try {
      const safeEmail = email.replace(/'/g, ' ');
      const customers = await stripe.customers.search({ query: `email:'${safeEmail}'` });
      const cust = customers.data[0];
      if (cust?.id) {
        await sb
          .from('entitlements')
          .upsert({ user_id: row.user_id, stripe_customer_id: cust.id }, { onConflict: 'user_id' });
        results.push({ user_id: row.user_id, email, customer_id: cust.id, status: 'ok' });
      } else {
        results.push({ user_id: row.user_id, email, status: 'not-found' });
      }
    } catch (e: any) {
      console.error('Stripe search error for', email, e);
      results.push({ user_id: row.user_id, email, status: 'error' });
    }
  }

  return NextResponse.json({ count: results.length, results });
}
