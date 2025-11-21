"use server";
// This is a "Server Action"
// It runs securely on the server, not in the browser.

import { auth } from "@clerk/nextjs/server";
import prisma from "@/lib/prisma";
import { stripe } from "@/lib/stripe";

const GRACE_PERIOD_DAYS = 2; // Give 2 days grace period

export const getUserSubscription = async (): Promise<boolean> => {
  const { userId } = auth();

  if (!userId) {
    return false;
  }

  try {
    const user = await prisma.user.findUnique({
      where: {
        clerkId: userId,
      },
      select: {
        id: true,
        stripeSubscriptionId: true,
        stripeCurrentPeriodEnd: true,
        stripeCustomerId: true,
      },
    });

    if (!user) {
      return false; // User not synced to DB yet
    }

    // 1. Check DB first
    const isDbValid =
      user.stripeSubscriptionId &&
      user.stripeCurrentPeriodEnd &&
      user.stripeCurrentPeriodEnd.getTime() +
        GRACE_PERIOD_DAYS * 24 * 60 * 60 * 1000 >
        Date.now();

    if (isDbValid) {
      return true;
    }

    // 2. Fallback: Check Stripe directly if DB says not pro but we have a customer ID
    if (user.stripeCustomerId) {
      try {
        console.log(`[Subscription] Checking Stripe API for customer ${user.stripeCustomerId}...`);
        const subscriptions = await stripe.subscriptions.list({
          customer: user.stripeCustomerId,
          limit: 5,
        });

        const activeSub = subscriptions.data.find(
          (sub) => sub.status === "active" || sub.status === "trialing"
        );

        if (activeSub) {
          console.log(`[Subscription] Found active subscription in Stripe: ${activeSub.id}`);

          // Self-heal the DB
          await prisma.user.update({
            where: { id: user.id },
            data: {
              stripeSubscriptionId: activeSub.id,
              stripeCurrentPeriodEnd: new Date(activeSub.current_period_end * 1000),
            },
          });

          return true;
        }
      } catch (stripeError) {
        console.error("[Subscription] Stripe API check failed:", stripeError);
      }
    }

    return false;
  } catch (error) {
    console.error("[GET_USER_SUBSCRIPTION_ERROR]", error);
    return false;
  }
};
