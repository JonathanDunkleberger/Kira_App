'use client';
import { useState, useRef, useEffect } from 'react';
import { UserButton, SignedIn, SignedOut, SignInButton } from '@clerk/nextjs';

export function AvatarMenu() {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    if (!open) return;
    const handler = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    };
    window.addEventListener('mousedown', handler);
    return () => window.removeEventListener('mousedown', handler);
  }, [open]);

  return (
    <div className="relative" ref={ref}>
      <SignedIn>
        <button
          onClick={() => setOpen((o) => !o)}
          className="h-8 w-8 rounded-full bg-[var(--accent)] text-white flex items-center justify-center text-xs font-medium shadow hover:opacity-90"
        >
          <UserButton afterSignOutUrl="/" />
        </button>
        {open && (
          <div className="absolute right-0 mt-2 w-48 rounded-lg border border-black/10 dark:border-white/10 bg-[var(--surface)] shadow-lg text-xs overflow-hidden">
            <div className="px-3 py-2 font-medium text-[var(--text)]">Account</div>
            <a href="/profile" className="block px-3 py-2 hover:bg-[var(--bg-muted)]">
              Profile
            </a>
            <a href="/settings" className="block px-3 py-2 hover:bg-[var(--bg-muted)]">
              Settings
            </a>
          </div>
        )}
      </SignedIn>
      <SignedOut>
        <SignInButton>
          <button className="px-3 py-1.5 rounded-md bg-[var(--accent)] text-white text-xs shadow hover:opacity-90">
            Sign In
          </button>
        </SignInButton>
      </SignedOut>
    </div>
  );
}
