// packages/web/components/layout/AppHeader.tsx
'use client';
import { UserButton } from '@clerk/nextjs';
import Link from 'next/link';
import { useState } from 'react';
import { ProfileOverlay } from '../auth/ProfileOverlay';

export function AppHeader() {
  const [isProfileOpen, setProfileOpen] = useState(false);

  return (
    <>
      <header className="fixed top-0 left-0 right-0 z-40 h-16 bg-transparent">
        <div className="mx-auto flex h-full max-w-5xl items-center justify-between px-4">
          {/* FIX: Changed the icon to be the text "Kira" */}
          <Link href="/" className="text-xl font-semibold text-neutral-800 dark:text-neutral-200">
            Kira
          </Link>
          {/* FIX: This clickable icon opens the profile overlay */}
          <div className="cursor-pointer" onClick={() => setProfileOpen(true)}>
            <UserButton afterSignOutUrl="/" />
          </div>
        </div>
      </header>
      <ProfileOverlay isOpen={isProfileOpen} onClose={() => setProfileOpen(false)} />
    </>
  );
}
