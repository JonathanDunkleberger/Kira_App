// packages/web/components/layout/AppHeader.tsx
'use client';
import { UserButton, SignedIn, SignedOut, SignInButton, useUser } from '@clerk/nextjs';
import Link from 'next/link';
import { useState } from 'react';
import { ProfileOverlay } from '../auth/ProfileOverlay';

export function AppHeader() {
  const [isProfileOpen, setProfileOpen] = useState(false);
  const { isLoaded, isSignedIn } = useUser();

  return (
    <>
      <header className="fixed top-0 left-0 right-0 z-40 h-16 bg-transparent">
        <div className="mx-auto flex h-full max-w-5xl items-center justify-between px-4">
          {/* FIX: Changed the icon to be the text "Kira" */}
          <Link href="/" className="text-xl font-semibold text-neutral-800 dark:text-neutral-200">
            Kira
          </Link>
          {/* Profile / Auth Area */}
          <div className="flex items-center gap-3">
            <SignedIn>
              <div className="cursor-pointer" onClick={() => setProfileOpen(true)}>
                <UserButton afterSignOutUrl="/" />
              </div>
            </SignedIn>
            <SignedOut>
              <SignInButton mode="modal">
                <button className="rounded-md border border-black/10 px-4 py-1.5 text-sm font-medium text-neutral-700 shadow-sm transition-colors hover:bg-black/5 dark:border-white/20 dark:text-neutral-200 dark:hover:bg-white/10">
                  Sign In
                </button>
              </SignInButton>
            </SignedOut>
          </div>
        </div>
      </header>
      <ProfileOverlay isOpen={isProfileOpen} onClose={() => setProfileOpen(false)} />
    </>
  );
}
