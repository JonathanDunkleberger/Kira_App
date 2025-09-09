import { headers } from 'next/headers';
import { NextResponse } from 'next/server';
import type { WebhookEvent } from '@clerk/nextjs/server';
import { Webhook } from 'svix';
import { prisma } from '../../../../lib/prisma';

// Expect env CLERK_WEBHOOK_SECRET
export async function POST(req: Request) {
  const WEBHOOK_SECRET = process.env.CLERK_WEBHOOK_SECRET;
  if (!WEBHOOK_SECRET) {
    return new NextResponse('Missing CLERK_WEBHOOK_SECRET', { status: 500 });
  }

  const payload = await req.text();
  const hdrs = await headers();
  const svix_id = hdrs.get('svix-id');
  const svix_timestamp = hdrs.get('svix-timestamp');
  const svix_signature = hdrs.get('svix-signature');

  if (!svix_id || !svix_timestamp || !svix_signature) {
    return new NextResponse('Missing svix headers', { status: 400 });
  }

  const wh = new Webhook(WEBHOOK_SECRET);
  let evt: WebhookEvent;
  try {
    evt = wh.verify(payload, {
      'svix-id': svix_id,
      'svix-timestamp': svix_timestamp,
      'svix-signature': svix_signature,
    }) as WebhookEvent;
  } catch (err) {
    return new NextResponse('Invalid signature', { status: 400 });
  }

  if (evt.type === 'user.created' || evt.type === 'user.updated') {
    const user = evt.data;
    const id = user.id;
    const email = user.email_addresses?.[0]?.email_address;
    if (id && email) {
      await prisma.user.upsert({
        where: { id },
        update: { email },
        create: { id, email },
      });
    }
  }

  return NextResponse.json({ ok: true });
}
