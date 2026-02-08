"use client";

import { useUser, useClerk } from "@clerk/nextjs";
import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import Link from "next/link";
import { Moon, Sun, Trash2, CreditCard, LogOut, ArrowLeft } from "lucide-react";

export default function ProfilePage() {
  const { user, isLoaded, isSignedIn } = useUser();
  const { signOut } = useClerk();
  const router = useRouter();
  const [isDarkMode, setIsDarkMode] = useState(false);

  useEffect(() => {
    if (isLoaded && !isSignedIn) {
      router.push("/");
    }
  }, [isLoaded, isSignedIn, router]);

  useEffect(() => {
    // Check local storage or system preference
    const isDark = localStorage.getItem("theme") === "dark" || 
      (!("theme" in localStorage) && window.matchMedia("(prefers-color-scheme: dark)").matches);
    setIsDarkMode(isDark);
    if (isDark) {
      document.documentElement.classList.add("dark");
    } else {
      document.documentElement.classList.remove("dark");
    }
  }, []);

  const toggleTheme = () => {
    const newMode = !isDarkMode;
    setIsDarkMode(newMode);
    if (newMode) {
      document.documentElement.classList.add("dark");
      localStorage.setItem("theme", "dark");
    } else {
      document.documentElement.classList.remove("dark");
      localStorage.setItem("theme", "light");
    }
  };

  const handleSignOut = async () => {
    await signOut();
    router.push("/");
  };

  const handleSubscription = async () => {
    try {
      // 1. Try to open portal
      const portalRes = await fetch("/api/stripe/portal", { method: "POST" });
      
      if (portalRes.ok) {
        const data = await portalRes.json();
        window.location.href = data.url;
        return;
      }

      // 2. If portal fails (404), try checkout
      if (portalRes.status === 404) {
        const checkoutRes = await fetch("/api/stripe/checkout", { method: "POST" });
        if (checkoutRes.ok) {
          const data = await checkoutRes.json();
          window.location.href = data.url;
          return;
        }
      }

      console.error("Failed to handle subscription");
    } catch (error) {
      console.error("Subscription error:", error);
    }
  };

  if (!isLoaded || !user) {
    return <div className="min-h-screen flex items-center justify-center bg-kira-bg dark:bg-tokyo-bg text-gray-500 dark:text-tokyo-fg">Loading...</div>;
  }

  return (
    <div className="min-h-screen bg-kira-bg dark:bg-tokyo-bg text-gray-900 dark:text-tokyo-fg transition-colors duration-300">
      <div className="max-w-2xl mx-auto p-6">
        {/* Header */}
        <div className="flex items-center gap-4 mb-12">
          <Link href="/" className="p-2 hover:bg-black/5 dark:hover:bg-white/10 rounded-full transition-colors">
            <ArrowLeft size={24} />
          </Link>
          <h1 className="text-3xl font-semibold">Profile</h1>
        </div>

        {/* User Info */}
        <div className="bg-white dark:bg-tokyo-card p-8 rounded-3xl shadow-sm mb-8 flex items-center gap-6 transition-colors duration-300">
          <img 
            src={user.imageUrl} 
            alt={user.fullName || "User"} 
            className="w-20 h-20 rounded-full border-4 border-kira-accent dark:border-tokyo-accent"
          />
          <div>
            <h2 className="text-2xl font-medium">{user.fullName}</h2>
            <p className="text-gray-500 dark:text-gray-400">{user.primaryEmailAddress?.emailAddress}</p>
          </div>
        </div>

        {/* Actions */}
        <div className="space-y-4">
          {/* Theme Toggle */}
          <button
            onClick={toggleTheme}
            className="w-full flex items-center justify-between p-6 bg-white dark:bg-tokyo-card rounded-2xl hover:scale-[1.02] transition-all duration-200 shadow-sm group"
          >
            <div className="flex items-center gap-4">
              <div className="p-3 bg-gray-100 dark:bg-black/20 rounded-xl group-hover:bg-kira-accent dark:group-hover:bg-tokyo-accent transition-colors">
                {isDarkMode ? <Moon size={24} /> : <Sun size={24} />}
              </div>
              <div className="text-left">
                <h3 className="font-medium text-lg">Appearance</h3>
                <p className="text-sm text-gray-500 dark:text-gray-400">{isDarkMode ? "Dark Mode" : "Light Mode"}</p>
              </div>
            </div>
            <div className={`w-12 h-6 rounded-full p-1 transition-colors ${isDarkMode ? "bg-tokyo-accent" : "bg-gray-300"}`}>
              <div className={`w-4 h-4 rounded-full bg-white shadow-sm transition-transform ${isDarkMode ? "translate-x-6" : "translate-x-0"}`} />
            </div>
          </button>

          {/* Subscribe */}
          <button
            onClick={handleSubscription}
            className="w-full flex items-center justify-between p-6 bg-white dark:bg-tokyo-card rounded-2xl hover:scale-[1.02] transition-all duration-200 shadow-sm group"
          >
            <div className="flex items-center gap-4">
              <div className="p-3 bg-gray-100 dark:bg-black/20 rounded-xl group-hover:bg-kira-accent dark:group-hover:bg-tokyo-accent transition-colors">
                <CreditCard size={24} />
              </div>
              <div className="text-left">
                <h3 className="font-medium text-lg">Subscription</h3>
                <p className="text-sm text-gray-500 dark:text-gray-400">Manage your Pro plan</p>
              </div>
            </div>
          </button>

          {/* Sign Out */}
          <button
            onClick={handleSignOut}
            className="w-full flex items-center justify-between p-6 bg-white dark:bg-tokyo-card rounded-2xl hover:scale-[1.02] transition-all duration-200 shadow-sm group"
          >
            <div className="flex items-center gap-4">
              <div className="p-3 bg-gray-100 dark:bg-black/20 rounded-xl group-hover:bg-red-100 dark:group-hover:bg-red-900/30 transition-colors text-red-500">
                <LogOut size={24} />
              </div>
              <div className="text-left">
                <h3 className="font-medium text-lg text-red-500">Sign Out</h3>
              </div>
            </div>
          </button>

          {/* Delete Account */}
          <button
            className="w-full flex items-center justify-between p-6 bg-white dark:bg-tokyo-card rounded-2xl hover:scale-[1.02] transition-all duration-200 shadow-sm group border border-transparent hover:border-red-500/20"
          >
            <div className="flex items-center gap-4">
              <div className="p-3 bg-gray-100 dark:bg-black/20 rounded-xl group-hover:bg-red-100 dark:group-hover:bg-red-900/30 transition-colors text-red-500">
                <Trash2 size={24} />
              </div>
              <div className="text-left">
                <h3 className="font-medium text-lg text-red-500">Delete Account</h3>
                <p className="text-sm text-red-400/60">Permanently remove your data</p>
              </div>
            </div>
          </button>
        </div>
      </div>
    </div>
  );
}
