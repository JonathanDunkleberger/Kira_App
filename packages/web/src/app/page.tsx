"use client"; // This page is interactive, so it's a client component
export const dynamic = "force-dynamic"; // prevent prerender/SSG to avoid SSR-only runtime on client hooks

import { useUser, UserButton } from "@clerk/nextjs";
import Link from "next/link";
import { Phone, Star, Zap, User } from "lucide-react";
import { useSubscription } from "@/hooks/use-subscription"; // Our new hook
import { useState } from "react";
import ProfileModal from "@/components/ProfileModal";

// This is the clean "Sesame" clone homepage
export default function HomePage() {
  const { user, isSignedIn, isLoaded } = useUser();
  const { isPro, isLoading } = useSubscription();
  const [showProfileModal, setShowProfileModal] = useState(false);

  console.log("HomePage Render:", { isLoaded, isSignedIn, isPro, isLoading });
  // console.log("Clerk Key:", process.env.NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY);

  // if (!isLoaded) {
  //   return (
  //     <div className="flex items-center justify-center min-h-screen bg-kira-bg">
  //       <div className="animate-pulse text-gray-500">Loading Kira...</div>
  //     </div>
  //   );
  // }

  const getGreeting = () => {
    const hour = new Date().getHours();
    if (hour < 12) return "Good morning";
    if (hour < 18) return "Good afternoon";
    return "Good evening";
  };

  // This is the "Afternoon, Jonny" feature
  const greeting = user?.firstName
    ? `${getGreeting()}, ${user.firstName}`
    : getGreeting();

  const handleUpgrade = async () => {
    try {
      const res = await fetch("/api/stripe/checkout", { method: "POST" });
      if (res.ok) {
        const data = await res.json();
        window.location.href = data.url;
      } else {
        console.error("Failed to start checkout");
      }
    } catch (error) {
      console.error("Checkout error:", error);
    }
  };

  return (
    <div className="flex flex-col items-center justify-center min-h-screen p-4 bg-kira-bg text-gray-900 dark:bg-tokyo-bg dark:text-tokyo-fg transition-colors duration-300">
      {/* Header: Logo and Clerk Profile Icon */}
      <header className="absolute top-0 left-0 right-0 p-4 sm:p-6 flex justify-between items-center">
        <span className="font-semibold text-lg flex items-center gap-2">
          {/* Your Logo */}
          <svg
            width="24"
            height="24"
            viewBox="0 0 24 24"
            fill="none"
            xmlns="http://www.w3.org/2000/svg"
            className="text-black dark:text-tokyo-fg"
          >
            <path
              d="M12 2L2 7L12 12L22 7L12 2Z"
              stroke="currentColor"
              strokeWidth="2"
              strokeLinecap="round"
              strokeLinejoin="round"
            />
            <path
              d="M2 17L12 22L22 17"
              stroke="currentColor"
              strokeWidth="2"
              strokeLinecap="round"
              strokeLinejoin="round"
            />
            <path
              d="M2 12L12 17L22 12"
              stroke="currentColor"
              strokeWidth="2"
              strokeLinecap="round"
              strokeLinejoin="round"
            />
          </svg>
          Kira
        </span>
        <div className="flex items-center gap-4">
          {!isLoading && !isPro && isSignedIn && (
            <button
              onClick={handleUpgrade}
              className="flex items-center gap-1.5 text-sm font-medium text-white bg-blue-500 px-3 py-1.5 rounded-full hover:bg-blue-600 dark:bg-tokyo-accent dark:text-tokyo-bg dark:hover:bg-tokyo-accent/90 transition-colors"
            >
              <Zap size={14} />
              Upgrade
            </button>
          )}
          {/* Profile Button */}
          <button 
            onClick={() => setShowProfileModal(true)}
            className="p-2 hover:bg-black/5 dark:hover:bg-white/10 rounded-full transition-colors"
          >
            <User size={24} className="text-gray-600 dark:text-tokyo-fg" />
          </button>
        </div>
      </header>

      {/* Profile Modal */}
      <ProfileModal 
        isOpen={showProfileModal} 
        onClose={() => setShowProfileModal(false)} 
      />

      {/* Persona Button */}
      <main className="flex flex-col gap-6 w-full max-w-sm text-center">
        <h1 className="text-3xl font-medium text-gray-800 dark:text-tokyo-fg">{greeting}</h1>

        <Link
          href="/chat/kira" // This is the link to start the call
          className="flex items-center justify-center gap-3 p-8 bg-kira-green rounded-lg text-2xl font-medium text-gray-800 hover:bg-kira-green-dark transition-colors dark:bg-tokyo-card dark:text-tokyo-fg dark:hover:bg-tokyo-card/80 dark:border dark:border-tokyo-fg/10"
        >
          <Phone size={24} />
          <span>Talk to Kira</span>
        </Link>

        {/* We can add other personas here later */}
      </main>
    </div>
  );
}
