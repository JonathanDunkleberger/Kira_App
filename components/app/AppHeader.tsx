'use client';
import TopClockTimer from '@/components/TopClockTimer';
import { useState } from 'react';

export default function AppHeader() {
  // Placeholder profile menu state (expand with real auth later)
  const [open, setOpen] = useState(false);
  return (
    <header className="relative h-12 flex items-center justify-center border-b border-white/10 bg-black/40 backdrop-blur-sm">
      <TopClockTimer />
      <div className="absolute right-4 top-1/2 -translate-y-1/2">
        <button
          onClick={() => setOpen(o => !o)}
          className="rounded-full bg-white/10 hover:bg-white/20 px-3 py-1 text-sm"
        >
          Profile
        </button>
        {open && (
          <div className="mt-2 absolute right-0 w-48 rounded-md border border-white/10 bg-black/80 backdrop-blur p-2 text-sm space-y-1">
            <button className="block w-full text-left px-2 py-1 rounded hover:bg-white/10">Account</button>
            <button className="block w-full text-left px-2 py-1 rounded hover:bg-white/10">Upgrade</button>
            <button className="block w-full text-left px-2 py-1 rounded hover:bg-white/10">Theme</button>
            <button className="block w-full text-left px-2 py-1 rounded hover:bg-white/10">Sign out</button>
          </div>
        )}
      </div>
    </header>
  );
}
