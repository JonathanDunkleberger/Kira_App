"use client";

import { useUser, useClerk } from "@clerk/nextjs";
import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { Moon, Sun, Trash2, CreditCard, LogOut, X, User, FileText, Shield, MessageCircle } from "lucide-react";
import Link from "next/link";
import ConversationHistory from "./ConversationHistory";

interface ProfileModalProps {
  isOpen: boolean;
  onClose: () => void;
  isPro?: boolean;
}

export default function ProfileModal({ isOpen, onClose, isPro = false }: ProfileModalProps) {
  const { user, isLoaded, isSignedIn } = useUser();
  const { signOut, openSignIn } = useClerk();
  const router = useRouter();
  const [isDarkMode, setIsDarkMode] = useState(false);
  const [isDeleting, setIsDeleting] = useState(false);
  const [showDeleteConfirm, setShowDeleteConfirm] = useState(false);
  const [showHistory, setShowHistory] = useState(false);

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
        } else {
            console.error("Checkout failed with status:", checkoutRes.status);
            alert("Failed to start checkout. Please try again later.");
        }
      } else {
        console.error("Portal failed with status:", portalRes.status);
        alert("Failed to open subscription portal. Please try again later.");
      }

      console.error("Failed to handle subscription");
    } catch (error) {
      console.error("Subscription error:", error);
      alert("An error occurred. Please try again.");
    }
  };

  const handleDeleteAccount = async () => {
    try {
      setIsDeleting(true);
      const res = await fetch("/api/user/delete", {
        method: "DELETE",
      });

      if (!res.ok) {
        throw new Error("Failed to delete account");
      }

      // Sign out and redirect
      await signOut();
      router.push("/");
      onClose();
    } catch (error) {
      console.error("Delete account error:", error);
      alert("Failed to delete account. Please try again.");
    } finally {
      setIsDeleting(false);
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
                {/* Subscription Management */}
                <button
                  onClick={handleSubscription}
                  className="w-full flex items-center justify-between p-4 bg-gray-50 dark:bg-black/20 rounded-xl hover:bg-gray-100 dark:hover:bg-black/30 transition-colors group"
                >
                  <div className="flex items-center gap-3">
                    <div className="p-2 bg-white dark:bg-tokyo-bg rounded-lg text-gray-600 dark:text-tokyo-fg group-hover:text-kira-green-dark dark:group-hover:text-tokyo-accent transition-colors">
                      <CreditCard size={20} />
                    </div>
                    <span className="font-medium text-gray-700 dark:text-gray-200">
                      {isPro ? "Manage Subscription" : "Upgrade to Pro"}
                    </span>
                  </div>
                </button>

                {/* Past Conversations */}
                <button
                  onClick={() => setShowHistory(true)}
                  className="w-full flex items-center justify-between p-4 bg-gray-50 dark:bg-black/20 rounded-xl hover:bg-gray-100 dark:hover:bg-black/30 transition-colors group"
                >
                  <div className="flex items-center gap-3">
                    <div className="p-2 bg-white dark:bg-tokyo-bg rounded-lg text-gray-600 dark:text-tokyo-fg group-hover:text-kira-green-dark dark:group-hover:text-tokyo-accent transition-colors">
                      <MessageCircle size={20} />
                    </div>
                    <span className="font-medium text-gray-700 dark:text-gray-200">Past Conversations</span>
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
                {!showDeleteConfirm ? (
                  <button
                    onClick={() => setShowDeleteConfirm(true)}
                    className="w-full flex items-center justify-between p-4 bg-transparent rounded-xl hover:bg-red-50 dark:hover:bg-red-900/20 transition-colors group"
                  >
                    <div className="flex items-center gap-3">
                      <div className="p-2 rounded-lg text-gray-400 group-hover:text-red-500 transition-colors">
                        <Trash2 size={20} />
                      </div>
                      <span className="font-medium text-gray-400 group-hover:text-red-500">Delete Account</span>
                    </div>
                  </button>
                ) : (
                  <div className="w-full p-4 bg-red-50 dark:bg-red-900/20 rounded-xl border border-red-100 dark:border-red-900/50 animate-in fade-in slide-in-from-top-2">
                    <p className="text-sm text-red-600 dark:text-red-400 mb-3 font-medium">
                      Are you sure? This action cannot be undone.
                    </p>
                    <div className="flex gap-2">
                      <button
                        onClick={handleDeleteAccount}
                        disabled={isDeleting}
                        className="flex-1 py-2 px-3 bg-red-500 hover:bg-red-600 text-white rounded-lg text-sm font-medium transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
                      >
                        {isDeleting ? "Deleting..." : "Yes, Delete"}
                      </button>
                      <button
                        onClick={() => setShowDeleteConfirm(false)}
                        disabled={isDeleting}
                        className="flex-1 py-2 px-3 bg-white dark:bg-transparent border border-gray-200 dark:border-gray-700 text-gray-600 dark:text-gray-300 hover:bg-gray-50 dark:hover:bg-white/5 rounded-lg text-sm font-medium transition-colors"
                      >
                        Cancel
                      </button>
                    </div>
                  </div>
                )}
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

            {/* Legal Links */}
            <div className="pt-4 mt-4 border-t border-gray-100 dark:border-gray-800 grid grid-cols-2 gap-3">
                <Link 
                  href="/privacy" 
                  className="flex items-center justify-center gap-2 p-3 rounded-xl bg-gray-50 dark:bg-black/20 hover:bg-gray-100 dark:hover:bg-black/30 transition-colors text-sm font-medium text-gray-600 dark:text-gray-400"
                  onClick={onClose}
                >
                  <Shield size={16} />
                  Privacy
                </Link>
                <Link 
                  href="/terms" 
                  className="flex items-center justify-center gap-2 p-3 rounded-xl bg-gray-50 dark:bg-black/20 hover:bg-gray-100 dark:hover:bg-black/30 transition-colors text-sm font-medium text-gray-600 dark:text-gray-400"
                  onClick={onClose}
                >
                  <FileText size={16} />
                  Terms
                </Link>
            </div>
          </div>
        </div>
      </div>

      {/* Conversation History Overlay */}
      {showHistory && (
        <ConversationHistory onClose={() => setShowHistory(false)} />
      )}
    </div>
  );
}
