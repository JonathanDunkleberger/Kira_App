import { auth, currentUser } from "@clerk/nextjs/server";
import { headers } from "next/headers";
import { NextResponse } from "next/server";
import prisma from "@/lib/prisma";
import { stripe } from "@/lib/stripe";

const ALLOWED_ORIGINS = [
  "https://www.xoxokira.com",
  "https://xoxokira.com",
  ...(process.env.NODE_ENV !== "production" ? ["http://localhost:3000"] : []),
];

export async function POST(req: Request) {
  try {
    // CSRF protection: verify the request originates from our own site
    const origin = headers().get("origin");
    if (!origin || !ALLOWED_ORIGINS.includes(origin)) {
      return new NextResponse("Forbidden", { status: 403 });
    }

    const { userId } = auth();
    const user = await currentUser();

    if (!userId || !user) {
      return new NextResponse("Unauthorized", { status: 401 });
    }

    const userEmail = user.emailAddresses[0].emailAddress;

    // 1. Get or Create User in DB
    let dbUser = await prisma.user.findUnique({
      where: { clerkId: userId },
    });

    if (!dbUser) {
      dbUser = await prisma.user.create({
        data: {
          clerkId: userId,
          email: userEmail,
          name: `${user.firstName} ${user.lastName}`,
        },
      });
    }

    // 2. Create Stripe Customer if needed
    let stripeCustomerId = dbUser.stripeCustomerId;

    if (!stripeCustomerId) {
      const customer = await stripe.customers.create({
        email: userEmail,
        name: `${user.firstName} ${user.lastName}`,
        metadata: {
          userId: userId,
        },
      });
      stripeCustomerId = customer.id;
      await prisma.user.update({
        where: { id: dbUser.id },
        data: { stripeCustomerId },
      });
    }

    // 3. Create Checkout Session
    const priceId = process.env.STRIPE_PRICE_ID;
    const appUrl = process.env.NEXT_PUBLIC_APP_URL;

    if (!priceId) {
        console.error("Stripe Price ID missing");
        return new NextResponse("Stripe Price ID missing", { status: 500 });
    }

    if (!appUrl) {
        console.error("NEXT_PUBLIC_APP_URL missing");
        return new NextResponse("App URL configuration missing", { status: 500 });
    }

    console.log(`[STRIPE_CHECKOUT] Creating session for ${userEmail} with price ${priceId} return to ${appUrl}`);

    const session = await stripe.checkout.sessions.create({
      customer: stripeCustomerId,
      line_items: [
        {
          price: priceId,
          quantity: 1,
        },
      ],
      mode: "subscription",
      success_url: `${appUrl}/?success=true`,
      cancel_url: `${appUrl}/?canceled=true`,
      metadata: {
        userId: userId,
      },
    });

    return NextResponse.json({ url: session.url });
  } catch (error) {
    console.error("[STRIPE_CHECKOUT]", error);
    return new NextResponse("Internal Error", { status: 500 });
  }
}
