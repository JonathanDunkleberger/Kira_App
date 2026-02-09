import { headers } from "next/headers";
import { NextResponse } from "next/server";
import { Webhook } from "svix";
import prisma from "@/lib/prisma";

interface ClerkWebhookEvent {
  type: string;
  data: {
    id: string;
    email_addresses: { email_address: string }[];
    first_name?: string;
    last_name?: string;
    image_url?: string;
    unsafe_metadata?: { guestId?: string };
  };
}

export async function POST(req: Request) {
  const CLERK_WEBHOOK_SECRET = process.env.CLERK_WEBHOOK_SECRET;
  if (!CLERK_WEBHOOK_SECRET) {
    console.error("[CLERK_WEBHOOK] Missing CLERK_WEBHOOK_SECRET");
    return new NextResponse("Server misconfigured", { status: 500 });
  }

  const headerPayload = headers();
  const svixId = headerPayload.get("svix-id");
  const svixTimestamp = headerPayload.get("svix-timestamp");
  const svixSignature = headerPayload.get("svix-signature");

  if (!svixId || !svixTimestamp || !svixSignature) {
    return new NextResponse("Missing svix headers", { status: 400 });
  }

  const body = await req.text();

  let event: ClerkWebhookEvent;
  try {
    const wh = new Webhook(CLERK_WEBHOOK_SECRET);
    event = wh.verify(body, {
      "svix-id": svixId,
      "svix-timestamp": svixTimestamp,
      "svix-signature": svixSignature,
    }) as ClerkWebhookEvent;
  } catch (err: any) {
    console.error("[CLERK_WEBHOOK] Signature verification failed:", err.message);
    return new NextResponse("Invalid signature", { status: 400 });
  }

  console.log(`[CLERK_WEBHOOK] Received event: ${event.type}`, { userId: event.data.id });

  if (event.type === "user.created") {
    const { id: clerkId, email_addresses, first_name, last_name, image_url, unsafe_metadata } = event.data;
    const email = email_addresses[0]?.email_address;
    const name = [first_name, last_name].filter(Boolean).join(" ") || null;

    if (!email) {
      console.error("[CLERK_WEBHOOK] No email found for user:", clerkId);
      return new NextResponse("No email", { status: 400 });
    }

    // Upsert the user (may already exist from Stripe flow)
    await prisma.user.upsert({
      where: { clerkId },
      create: {
        clerkId,
        email,
        name,
        imageUrl: image_url,
      },
      update: {
        email,
        name,
        imageUrl: image_url,
      },
    });

    // Migrate guest conversation buffer if a guestId was attached
    const guestId = unsafe_metadata?.guestId;
    if (guestId) {
      console.log(`[CLERK_WEBHOOK] Migrating guest buffer for ${guestId} → ${clerkId}`);
      try {
        // Call the WS server's HTTP endpoint to retrieve and clear the buffer
        const wsUrl = process.env.NEXT_PUBLIC_WEBSOCKET_URL || "ws://localhost:10000";
        const httpUrl = wsUrl.replace(/^wss:/, "https:").replace(/^ws:/, "http:");
        const bufferRes = await fetch(`${httpUrl}/api/guest-buffer/${encodeURIComponent(guestId)}`, {
          method: "DELETE",
          headers: {
            "Authorization": `Bearer ${process.env.INTERNAL_API_SECRET}`,
          },
        });

        if (bufferRes.ok) {
          const buffer = await bufferRes.json();
          if (buffer.messages && buffer.messages.length > 0) {
            // Save the conversation to DB
            await prisma.conversation.create({
              data: {
                userId: clerkId,
                messages: {
                  create: buffer.messages.map((msg: { role: string; content: string }) => ({
                    role: msg.role,
                    content: msg.content,
                  })),
                },
              },
            });

            // Save conversation summary as initial memory
            if (buffer.summary) {
              await prisma.user.update({
                where: { clerkId },
                data: { memory: buffer.summary },
              });
            }

            console.log(`[CLERK_WEBHOOK] Migrated ${buffer.messages.length} messages for ${clerkId}`);
          }
        } else {
          console.log(`[CLERK_WEBHOOK] No guest buffer found for ${guestId} (may have expired)`);
        }
      } catch (err) {
        console.error("[CLERK_WEBHOOK] Failed to migrate guest buffer:", err);
        // Non-fatal — user is still created, they just lose guest memory
      }
    }
  }

  return new NextResponse(null, { status: 200 });
}
