'use client';
import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { UserButton, useUser } from '@clerk/nextjs';

import { ProfileDialog } from './profile/ProfileDialog';

export default function AppHeader() {
  const [open, setOpen] = useState(false);
  const { user } = useUser();
  return (
    <header className="fixed inset-x-0 top-0 z-50 flex items-center justify-between px-3 py-2 pointer-events-none">
      <div className="opacity-90 pointer-events-auto select-none font-semibold text-sm tracking-wide">
        Kira
      </div>
      <div className="pointer-events-auto flex items-center gap-2">
        <button
          aria-label="Open profile dialog"
          onClick={() => setOpen(true)}
          className="rounded-full p-2 hover:bg-black/5 dark:hover:bg-white/10 transition"
        >
          <span className="i-lucide-user w-5 h-5" />
        </button>
        <UserButton afterSignOutUrl="/" />
      </div>
      <ProfileDialog
        open={open}
        onOpenChange={setOpen}
        email={user?.primaryEmailAddress?.emailAddress || user?.emailAddresses?.[0]?.emailAddress}
        displayName={user?.fullName || user?.username || null}
      />
    </header>
  );
}
