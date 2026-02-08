"use client"; // This page is interactive, so it's a client component
export const dynamic = "force-dynamic"; // prevent prerender/SSG to avoid SSR-only runtime on client hooks

import { useUser, useClerk } from "@clerk/nextjs";
import Link from "next/link";
import { Phone, Zap, User } from "lucide-react";
import { useSubscription } from "@/hooks/use-subscription"; // Our new hook
import { useState, useEffect } from "react";
import ProfileModal from "@/components/ProfileModal";

// This is the clean "Sesame" clone homepage
export default function HomePage() {
  const { user, isSignedIn, isLoaded } = useUser();
  const { openSignIn } = useClerk();
  const { isPro, isLoading } = useSubscription();
  const [showProfileModal, setShowProfileModal] = useState(false);
  const [timeGreeting, setTimeGreeting] = useState("Hello");

  useEffect(() => {
    const hour = new Date().getHours();
    if (hour < 12) setTimeGreeting("Good morning");
    else if (hour < 18) setTimeGreeting("Good afternoon");
    else setTimeGreeting("Good evening");
  }, []);

  // This is the "Afternoon, Jonny" feature
  const greeting = user?.firstName
    ? `${timeGreeting}, ${user.firstName}`
    : timeGreeting;

  const handleUpgrade = async () => {
    if (!isSignedIn) {
      openSignIn();
      return;
    }

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
          {!isLoading && !isPro && (
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
        isPro={isPro}
      />

      {/* Persona Button */}
      <main className="flex flex-col items-center gap-0 w-full max-w-md text-center">
        {isSignedIn ? (
          <h1 className="text-[26px] font-light tracking-[-0.01em] mb-8 text-gray-700 dark:text-[rgba(139,157,195,0.85)] transition-colors duration-500">
            {greeting}
          </h1>
        ) : (
          <div className="flex flex-col items-center gap-2 mb-9">
            <h1 className="text-2xl font-light tracking-[-0.01em] text-center leading-[1.4] m-0 text-gray-700 dark:text-[rgba(139,157,195,0.85)] transition-colors duration-500">
              An AI companion that actually<br />remembers you.
            </h1>
            <p className="text-sm font-light tracking-[0.01em] m-0 text-gray-400 dark:text-[rgba(139,157,195,0.35)] transition-colors duration-500">
              Real-time voice · Persistent memory · Screen sharing
            </p>
          </div>
        )}

        <Link
          href="/chat/kira"
          className="inline-flex items-center gap-2.5 px-9 py-4 rounded-[14px] text-base font-normal tracking-[0.01em] transition-all duration-300 border border-gray-200 dark:border-[rgba(139,157,195,0.12)] bg-gray-50 dark:bg-[rgba(139,157,195,0.06)] text-gray-700 dark:text-[rgba(139,157,195,0.85)] hover:bg-gray-100 dark:hover:bg-[rgba(139,157,195,0.1)]"
        >
          <Phone size={18} />
          <span>Talk to Kira</span>
        </Link>
      </main>
    </div>
  );
}
