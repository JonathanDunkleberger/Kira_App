'use client';
import { useState } from 'react';
import ProfileHub from '@/components/profile/ProfileHub';

export default function AppHeader() {
  const [open, setOpen] = useState(false);
  return (
    <header className="fixed inset-x-0 top-0 z-50 flex items-center justify-between px-3 py-2 pointer-events-none">
      <div className="opacity-90 pointer-events-auto select-none font-semibold text-sm tracking-wide">
        Kira
      </div>
      <button
        aria-label="Open profile"
        onClick={() => setOpen(true)}
        className="pointer-events-auto rounded-full p-2 hover:bg-black/5 dark:hover:bg-white/10 transition"
      >
        <span className="i-lucide-user w-5 h-5" />
      </button>
      <ProfileHub open={open} onOpenChange={setOpen} />
    </header>
  );
}
