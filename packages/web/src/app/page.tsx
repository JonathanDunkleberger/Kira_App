"use client"; // This page is interactive, so it's a client component
export const dynamic = "force-dynamic"; // prevent prerender/SSG to avoid SSR-only runtime on client hooks

import { useUser, UserButton } from "@clerk/nextjs";
import Link from "next/link";
import { Phone, Star, Zap } from "lucide-react";
import { useSubscription } from "@/hooks/use-subscription"; // Our new hook

// This is the clean "Sesame" clone homepage
export default function HomePage() {
  const { user, isSignedIn } = useUser();
  const { isPro, isLoading } = useSubscription();

  const getGreeting = () => {
    const hour = new Date().getHours();
    if (hour < 12) return "Morning";
    if (hour < 18) return "Afternoon";
    return "Evening";
  };

  // This is the "Afternoon, Jonny" feature
  const greeting = user?.firstName
    ? `${getGreeting()}, ${user.firstName}`
    : getGreeting();

  return (
    <div className="flex flex-col items-center justify-center min-h-screen p-4 bg-kira-bg text-gray-900">
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
            <Link
              href="/subscribe" // We will build this page in Goal 3 (Paywall)
              className="flex items-center gap-1.5 text-sm font-medium text-yellow-600 bg-yellow-100/50 px-3 py-1.5 rounded-full hover:bg-yellow-100"
            >
              <Zap size={14} />
              Upgrade
            </Link>
          )}
          <UserButton afterSignOutUrl="/" />
        </div>
      </header>

      {/* Persona Button */}
      <main className="flex flex-col gap-6 w-full max-w-sm text-center">
        <h1 className="text-3xl font-medium text-gray-800">{greeting}</h1>

        <Link
          href="/chat/kira" // This is the link to start the call
          className="flex items-center justify-center gap-3 p-8 bg-kira-green rounded-lg text-2xl font-medium text-gray-800 hover:bg-kira-green-dark transition-colors"
        >
          <Phone size={24} />
          <span>Talk to Kira</span>
        </Link>

        {/* We can add other personas here later */}
      </main>

      {/* Footer (for the 5-star rating link) */}
      <footer className="absolute bottom-6 text-sm">
        <button className="flex items-center gap-1.5 text-gray-500 hover:text-gray-900 transition-colors">
          <Star size={14} />
          Rate your conversations
        </button>
      </footer>
    </div>
  );
}
