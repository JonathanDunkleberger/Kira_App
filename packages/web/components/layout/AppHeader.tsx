// packages/web/components/layout/AppHeader.tsx
'use client';
import { UserButton } from '@clerk/nextjs';
import Link from 'next/link';

export function AppHeader() {
  return (
    <header className="fixed top-0 left-0 right-0 z-50 h-16 bg-transparent">
      <div className="mx-auto flex h-full max-w-5xl items-center justify-between px-4">
        <Link href="/" aria-label="Home">
          <span className="text-2xl">🎙️</span>
        </Link>
        <UserButton afterSignOutUrl="/" />
      </div>
    </header>
  );
}
