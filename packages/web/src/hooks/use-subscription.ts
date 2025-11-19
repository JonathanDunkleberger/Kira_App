"use client";

// This hook will check if the user has an active Stripe subscription
// by talking to your Supabase/Prisma database.
import { useState, useEffect } from "react";
import { useUser } from "@clerk/nextjs";

// We'll create this server action in the next step
import { getUserSubscription } from "@/app/actions/subscription";

export const useSubscription = () => {
  const { user } = useUser();
  const [isPro, setIsPro] = useState(false);
  const [isLoading, setIsLoading] = useState(true);

  useEffect(() => {
    if (!user) {
      setIsLoading(false);
      return;
    }

    const checkSubscription = async () => {
      try {
        setIsLoading(true);
        const isProMember = await getUserSubscription();
        setIsPro(isProMember);
      } catch (error) {
        console.error("Failed to check subscription:", error);
        setIsPro(false); // Default to free tier on error
      } finally {
        setIsLoading(false);
      }
    };

    checkSubscription();
  }, [user]);

  return { isPro, isLoading };
};
