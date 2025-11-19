"use client";

import { useUser, useClerk } from "@clerk/nextjs";
import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { Moon, Sun, Trash2, CreditCard, LogOut, X, User } from "lucide-react";

interface ProfileModalProps {
  isOpen: boolean;
  onClose: () => void;
}

export default function ProfileModal({ isOpen, onClose }: ProfileModalProps) {
  const { user, isLoaded, isSignedIn } = useUser();
  const { signOut, openSignIn } = useClerk();
  const router = useRouter();
  const [isDarkMode, setIsDarkMode] = useState(false);

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

    // Listen for storage changes to sync across tabs
    const handleStorageChange = (e: StorageEvent) => {
      if (e.key === "theme") {
        const newIsDark = e.newValue === "dark";
        setIsDarkMode(newIsDark);
        if (newIsDark) {
          document.documentElement.classList.add("dark");
        } else {
          document.documentElement.classList.remove("dark");
        }
      }
    };

    window.addEventListener("storage", handleStorageChange);
    return () => window.removeEventListener("storage", handleStorageChange);
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
    onClose();
  };

  const handleSignIn = () => {
    openSignIn({
      afterSignInUrl: "/",
      afterSignUpUrl: "/",
    });
    onClose();
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

  if (!isOpen) return null;

  if (!isLoaded) {
    return null;
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 backdrop-blur-sm animate-in fade-in duration-200">
      <div className="relative w-full max-w-md mx-4 bg-white dark:bg-tokyo-card rounded-3xl shadow-2xl overflow-hidden animate-in zoom-in-95 duration-200">
        
        {/* Close Button */}
        <button 
          onClick={onClose}
          className="absolute top-4 right-4 p-2 text-gray-400 hover:text-gray-600 dark:hover:text-gray-200 transition-colors z-10"
        >
          <X size={24} />
        </button>

        <div className="p-8">
          <h2 className="text-2xl font-semibold mb-8 text-gray-900 dark:text-tokyo-fg">Profile</h2>

          {/* User Info */}
          <div className="flex items-center gap-4 mb-8">
            {isSignedIn && user ? (
              <>
                <img 
                  src={user.imageUrl} 
                  alt={user.fullName || "User"} 
                  className="w-16 h-16 rounded-full border-2 border-kira-green dark:border-tokyo-accent"
                />
                <div>
                  <h3 className="text-xl font-medium text-gray-900 dark:text-tokyo-fg">{user.fullName}</h3>
                  <p className="text-sm text-gray-500 dark:text-gray-400">{user.primaryEmailAddress?.emailAddress}</p>
                </div>
              </>
            ) : (
              <>
                <div className="w-16 h-16 rounded-full bg-gray-200 dark:bg-gray-700 flex items-center justify-center">
                  <User size={32} className="text-gray-400 dark:text-gray-500" />
                </div>
                <div>
                  <h3 className="text-xl font-medium text-gray-900 dark:text-tokyo-fg">Guest User</h3>
                  <p className="text-sm text-gray-500 dark:text-gray-400">Sign in to save your progress</p>
                </div>
              </>
            )}
          </div>

          {/* Actions */}
          <div className="space-y-3">
            {/* Theme Toggle */}
            <button
              onClick={toggleTheme}
              className="w-full flex items-center justify-between p-4 bg-gray-50 dark:bg-black/20 rounded-xl hover:bg-gray-100 dark:hover:bg-black/30 transition-colors group"
            >
              <div className="flex items-center gap-3">
                <div className="p-2 bg-white dark:bg-tokyo-bg rounded-lg text-gray-600 dark:text-tokyo-fg group-hover:text-kira-green-dark dark:group-hover:text-tokyo-accent transition-colors">
                  {isDarkMode ? <Moon size={20} /> : <Sun size={20} />}
                </div>
                <span className="font-medium text-gray-700 dark:text-gray-200">Appearance</span>
              </div>
              <div className={`w-10 h-5 rounded-full p-0.5 transition-colors ${isDarkMode ? "bg-tokyo-accent" : "bg-gray-300"}`}>
                <div className={`w-4 h-4 rounded-full bg-white shadow-sm transition-transform ${isDarkMode ? "translate-x-5" : "translate-x-0"}`} />
              </div>
            </button>

            {isSignedIn ? (
              <>
                {/* Subscribe */}
                <button
                  onClick={handleSubscription}
                  className="w-full flex items-center justify-between p-4 bg-gray-50 dark:bg-black/20 rounded-xl hover:bg-gray-100 dark:hover:bg-black/30 transition-colors group"
                >
                  <div className="flex items-center gap-3">
                    <div className="p-2 bg-white dark:bg-tokyo-bg rounded-lg text-gray-600 dark:text-tokyo-fg group-hover:text-kira-green-dark dark:group-hover:text-tokyo-accent transition-colors">
                      <CreditCard size={20} />
                    </div>
                    <span className="font-medium text-gray-700 dark:text-gray-200">Subscription</span>
                  </div>
                </button>

                {/* Sign Out */}
                <button
                  onClick={handleSignOut}
                  className="w-full flex items-center justify-between p-4 bg-gray-50 dark:bg-black/20 rounded-xl hover:bg-red-50 dark:hover:bg-red-900/20 transition-colors group"
                >
                  <div className="flex items-center gap-3">
                    <div className="p-2 bg-white dark:bg-tokyo-bg rounded-lg text-red-500 group-hover:text-red-600 transition-colors">
                      <LogOut size={20} />
                    </div>
                    <span className="font-medium text-red-500 group-hover:text-red-600">Sign Out</span>
                  </div>
                </button>

                {/* Delete Account */}
                <button
                  className="w-full flex items-center justify-between p-4 bg-transparent rounded-xl hover:bg-red-50 dark:hover:bg-red-900/20 transition-colors group"
                >
                  <div className="flex items-center gap-3">
                    <div className="p-2 rounded-lg text-gray-400 group-hover:text-red-500 transition-colors">
                      <Trash2 size={20} />
                    </div>
                    <span className="font-medium text-gray-400 group-hover:text-red-500">Delete Account</span>
                  </div>
                </button>
              </>
            ) : (
              /* Sign In */
              <button
                onClick={handleSignIn}
                className="w-full flex items-center justify-between p-4 bg-gray-50 dark:bg-black/20 rounded-xl hover:bg-kira-green/10 dark:hover:bg-kira-green/20 transition-colors group"
              >
                <div className="flex items-center gap-3">
                  <div className="p-2 bg-white dark:bg-tokyo-bg rounded-lg text-kira-green-dark dark:text-tokyo-accent group-hover:text-kira-green-darker transition-colors">
                    <User size={20} />
                  </div>
                  <span className="font-medium text-kira-green-dark dark:text-tokyo-accent">Sign In</span>
                </div>
              </button>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
