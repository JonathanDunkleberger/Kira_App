"use server";
// This is a "Server Action"
// It runs securely on the server, not in the browser.

import { auth } from "@clerk/nextjs/server";
import prisma from "@/lib/prisma";

const GRACE_PERIOD_DAYS = 2; // Give 2 days grace period

export const getUserSubscription = async (): Promise<boolean> => {
  const { userId } = auth();

  if (!userId) {
    return false;
  }

  const user = await prisma.user.findUnique({
    where: {
      clerkId: userId,
    },
    select: {
      stripeSubscriptionId: true,
      stripeCurrentPeriodEnd: true,
    },
  });

  if (!user) {
    return false; // User not synced to DB yet
  }

  if (!user.stripeSubscriptionId || !user.stripeCurrentPeriodEnd) {
    return false; // Not a pro member
  }

  // Check if the subscription is still valid (with a 2-day grace period)
  const isValid =
    user.stripeCurrentPeriodEnd.getTime() +
      GRACE_PERIOD_DAYS * 24 * 60 * 60 * 1000 >
    Date.now();

  return isValid;
};
