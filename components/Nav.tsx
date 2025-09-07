'use client';
import Link from 'next/link';

import UsageBadge from '@/components/UsageBadge';

export default function Nav() {
  return (
    <header className="w-full py-3 px-4 flex items-center justify-between bg-black/40 backdrop-blur">
      <Link href="/" className="font-semibold">
        Kira
      </Link>
      <nav className="flex items-center gap-4 text-sm">
        <Link href="/conversations" className="opacity-80 hover:opacity-100">
          Conversations
        </Link>
        <Link href="/subscribe" className="opacity-80 hover:opacity-100">
          Subscribe
        </Link>
        <UsageBadge />
      </nav>
    </header>
  );
}
