import { auth, clerkClient } from "@clerk/nextjs/server";
import { NextResponse } from "next/server";
import prisma from "@/lib/prisma";
import { stripe } from "@/lib/stripe";

export async function DELETE() {
  try {
    const { userId } = auth();

    if (!userId) {
      return new NextResponse("Unauthorized", { status: 401 });
    }

    // --- 1. Cancel Stripe subscription (if active) ---
    // Do this FIRST so the user stops getting billed even if later steps fail.
    try {
      const dbUser = await prisma.user.findUnique({
        where: { clerkId: userId },
        select: { stripeSubscriptionId: true },
      });
      if (dbUser?.stripeSubscriptionId) {
        await stripe.subscriptions.cancel(dbUser.stripeSubscriptionId);
        console.log(`[DELETE_ACCOUNT] Cancelled Stripe subscription ${dbUser.stripeSubscriptionId}`);
      }
    } catch (stripeErr) {
      // Log but continue — don't block deletion because of Stripe issues
      console.error("[DELETE_ACCOUNT] Stripe cancellation failed (continuing):", stripeErr);
    }

    // --- 2. Clean up usage records via Prisma ---
    try {
      await prisma.monthlyUsage.deleteMany({ where: { userId } });
      console.log(`[DELETE_ACCOUNT] Deleted MonthlyUsage for ${userId}`);
    } catch (usageErr) {
      console.error("[DELETE_ACCOUNT] MonthlyUsage cleanup failed (continuing):", usageErr);
    }

    // --- 3. Delete from Prisma (User + cascaded Conversations, Messages, MemoryFacts) ---
    await prisma.user.delete({
      where: {
        clerkId: userId,
      },
    });
    console.log(`[DELETE_ACCOUNT] Deleted Prisma User + cascaded data for ${userId}`);

    // --- 4. Delete from Clerk ---
    await clerkClient.users.deleteUser(userId);
    console.log(`[DELETE_ACCOUNT] Deleted Clerk user ${userId}`);

    return new NextResponse("User deleted", { status: 200 });
  } catch (error) {
    console.error("[DELETE_ACCOUNT]", error);
    return new NextResponse("Internal Error", { status: 500 });
  }
}
