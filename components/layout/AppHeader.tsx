"use client";
import { UserButton } from '@clerk/nextjs';
import { useState } from 'react';

import { ProfileSettingsModal } from '../auth/ProfileSettingsModal';

export function AppHeader() {
  const [open, setOpen] = useState(false);
  return (
    <header className="w-full border-b border-black/5 dark:border-white/10 bg-[#f8f5ef] dark:bg-neutral-900/70 backdrop-blur-sm">
      <div className="mx-auto max-w-5xl px-4 h-14 flex items-center justify-between">
        <div className="font-semibold text-lg tracking-tight text-neutral-800 dark:text-neutral-100 select-none">Kira</div>
        <button
          type="button"
          onClick={() => setOpen(true)}
          className="rounded-full focus:outline-none focus:ring-2 focus:ring-black/20 dark:focus:ring-white/30"
        >
          <UserButton afterSignOutUrl="/" />
        </button>
      </div>
      <ProfileSettingsModal open={open} onOpenChange={setOpen} />
    </header>
  );
}
