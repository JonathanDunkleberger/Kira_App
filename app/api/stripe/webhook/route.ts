import { NextRequest, NextResponse } from 'next/server';
import Stripe from 'stripe';
import { env } from '@/lib/env';
import { addSupporter } from '@/lib/usage';
import { getSupabaseServerAdmin } from '@/lib/supabaseAdmin';

export const runtime = 'nodejs';

export async function POST(req: NextRequest) {
  const sig = req.headers.get('stripe-signature')!;
  const buf = Buffer.from(await req.arrayBuffer());

  let event: Stripe.Event;
  try {
    event = new Stripe(env.STRIPE_SECRET_KEY, { apiVersion: '2024-06-20' })
      .webhooks.constructEvent(buf, sig, env.STRIPE_WEBHOOK_SECRET);
  } catch (err: any) {
    return new NextResponse(`Webhook Error: ${err.message}`, { status: 400 });
  }

  if (event.type === 'checkout.session.completed') {
    const session = event.data.object as Stripe.Checkout.Session;
    const userId = session.metadata?.userId;
    const customerEmail = session.customer_details?.email; // Get email from the session

    // Ensure we have the user ID and the email they entered at checkout
    if (userId && customerEmail) {
      const sbAdmin = getSupabaseServerAdmin();
      
      // Promote the anonymous user to a permanent one by adding their email
      const { error: updateError } = await sbAdmin.auth.admin.updateUserById(
        userId,
        { email: customerEmail }
      );

      if (updateError) {
        console.error(`Webhook Error: Failed to update user ${userId} with email ${customerEmail}`, updateError);
      } else {
        // If the email update was successful, grant unlimited access
        await addSupporter(userId);
      }
    }
  }

  return NextResponse.json({ received: true });
}