import { auth, clerkClient } from "@clerk/nextjs/server";
import { NextResponse } from "next/server";
import prisma from "@/lib/prisma";
import { stripe } from "@/lib/stripe";
import { createClient } from "@supabase/supabase-js";

function getSupabase() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL || process.env.SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) return null;
  return createClient(url, key);
}

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

    // --- 2. Delete from Supabase (pro_usage + guest_usage) ---
    // These tables are outside Prisma and won't cascade.
    const supabase = getSupabase();
    if (supabase) {
      try {
        // Delete pro usage record (keyed by clerk_id)
        const { error: proErr } = await supabase
          .from("pro_usage")
          .delete()
          .eq("clerk_id", userId);
        if (proErr) console.error("[DELETE_ACCOUNT] pro_usage delete failed:", proErr.message);
        else console.log(`[DELETE_ACCOUNT] Deleted pro_usage for ${userId}`);

        // Note: guest_usage is keyed by guest_id (e.g. "guest_abc123"), not clerkId.
        // We can't reliably map clerkId → guestId here. Guest usage rows are
        // low-sensitivity (just a counter) and expire daily, so this is acceptable.
        // If the client passes guestId in the future, we can clean that too.
      } catch (supaErr) {
        console.error("[DELETE_ACCOUNT] Supabase cleanup failed (continuing):", supaErr);
      }
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
