// packages/web/components/auth/ProfileOverlay.tsx
'use client';

import { useState, useEffect } from 'react';
import { useUser, SignedIn, SignedOut, SignInButton, SignOutButton } from '@clerk/nextjs';
import { useTheme } from 'next-themes';
import {
  startCheckout,
  openBillingPortal,
  clearAllConversations,
  deleteAccount,
  fetchEntitlement,
} from '../../lib/client-api';

interface ProfileOverlayProps {
  isOpen: boolean;
  onClose: () => void;
}

export function ProfileOverlay({ isOpen, onClose }: ProfileOverlayProps) {
  const { user, isSignedIn } = useUser();
  const { theme, setTheme } = useTheme();
  const [name, setName] = useState('');
  const [isSaving, setIsSaving] = useState(false);
  const [isProUser, setIsProUser] = useState<boolean>(false);

  useEffect(() => {
    const fetchName = async () => {
      if (isOpen && user) {
        try {
          const response = await fetch('/api/user/name');
          if (response.ok) {
            const data = await response.json();
            setName(data.name || user.firstName || '');
          } else {
            setName(user.firstName || '');
          }
        } catch {
          setName(user.firstName || '');
        }
      }
    };
    const fetchSub = async () => {
      if (isOpen && user) {
        try {
          const ent = await fetchEntitlement();
          setIsProUser(Boolean(ent && ent.plan !== 'free' && ent.status === 'active'));
        } catch {
          setIsProUser(false);
        }
      }
    };
    fetchName();
    fetchSub();
  }, [isOpen, user]);

  const handleSaveName = async () => {
    setIsSaving(true);
    try {
      await fetch('/api/user/name', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name }),
      });
    } catch (error) {
      console.error('Failed to save name', error);
    } finally {
      setIsSaving(false);
    }
  };

  if (!isOpen) return null;

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 backdrop-blur-sm"
      onClick={onClose}
    >
      <div
        className="relative w-full max-w-sm rounded-xl border border-black/10 bg-[#f4f4f0] p-6 text-[#3b3a33] dark:border-white/10 dark:bg-[#2e2d29] dark:text-[#e4e2d7]"
        onClick={(e) => e.stopPropagation()}
      >
        <SignedOut>
          <h2 className="mb-4 text-xl font-medium">Welcome</h2>
          <p className="mb-6 text-sm text-neutral-600 dark:text-neutral-400">Sign in to personalize Kira, manage your subscription, and access conversation history.</p>
          <SignInButton mode="modal">
            <button className="w-full rounded-lg bg-neutral-800 px-4 py-2 text-sm font-medium text-white shadow-sm transition-colors hover:bg-neutral-700 dark:bg-neutral-100 dark:text-neutral-900 dark:hover:bg-neutral-200">Sign In</button>
          </SignInButton>
        </SignedOut>
        <SignedIn>
          <h2 className="mb-4 text-xl font-medium">Your Account</h2>
          <div className="mb-6 text-sm">
            <p className="text-neutral-500">Logged in as</p>
            <p>{user?.primaryEmailAddress?.toString()}</p>
          </div>
          <div className="mb-6">
            <label htmlFor="name" className="mb-2 block text-sm text-neutral-500">What should we call you?</label>
            <div className="relative">
              <input
                id="name"
                type="text"
                value={name}
                onChange={(e) => setName(e.target.value)}
                onBlur={handleSaveName}
                disabled={isSaving}
                className="w-full rounded-lg border border-black/10 bg-white/50 p-2 dark:border-white/10 dark:bg-black/20"
              />
            </div>
          </div>
        </SignedIn>
        {/* Settings & Actions */}
        <div className="mt-6 space-y-2 border-t border-black/10 pt-4 dark:border-white/10">
          <button
            onClick={() => setTheme(theme === 'dark' ? 'light' : 'dark')}
            className="w-full rounded-lg p-2 text-left transition-colors hover:bg-black/5 dark:hover:bg-white/5"
          >
            Toggle Theme
          </button>
          {isProUser ? (
            <button
              onClick={openBillingPortal}
              className="w-full rounded-lg p-2 text-left transition-colors hover:bg-black/5 dark:hover:bg-white/5"
            >
              Manage Billing
            </button>
          ) : (
            <button
              onClick={startCheckout}
              className="w-full rounded-lg p-2 text-left font-medium text-green-700 transition-colors hover:bg-black/5 dark:text-green-400 dark:hover:bg-white/5"
            >
              Subscribe to Pro
            </button>
          )}
          <SignedIn>
            <SignOutButton signOutOptions={{ redirectUrl: '/' }}>
              <button className="w-full rounded-lg p-2 text-left text-neutral-600 transition-colors hover:bg-black/5 dark:text-neutral-300 dark:hover:bg-white/5">Sign Out</button>
            </SignOutButton>
          </SignedIn>
        </div>
        {/* Danger Zone */}
        <SignedIn>
          <div className="mt-4 space-y-2 border-t border-black/10 pt-4 text-sm text-red-600 dark:text-red-500">
            <button
              onClick={clearAllConversations}
              className="w-full rounded-lg p-2 text-left transition-colors hover:bg-red-500/10"
            >Delete Conversation History</button>
            <button
              onClick={deleteAccount}
              className="w-full rounded-lg p-2 text-left transition-colors hover:bg-red-500/10"
            >Delete Account</button>
          </div>
        </SignedIn>
      </div>
    </div>
  );
}
