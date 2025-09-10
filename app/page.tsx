'use client';
import { useEffect, useMemo, useState } from 'react';
import Link from 'next/link';

import { CharacterCard } from '../components/ui/CharacterCard';

function greet(): string {
  const h = new Date().getHours();
  if (h < 12) return 'Morning';
  if (h < 18) return 'Afternoon';
  return 'Evening';
}

export default function HomePage() {
  const [name, setName] = useState('there');
  const conversationId = useMemo(() => crypto.randomUUID(), []);
  useEffect(() => {
    try {
      const cookieMatch = document.cookie.match(/(?:^|; )kira_name=([^;]+)/);
      if (cookieMatch && cookieMatch[1]) setName(decodeURIComponent(cookieMatch[1]));
    } catch {
      /* noop */
    }
  }, []);
  return (
    <main className="min-h-[calc(100vh-3rem)] flex items-center justify-center p-6">
      <CharacterCard
        name="Kira"
        subtitle={`${greet()}, ${name}`}
        description="Real-time voice conversation. Just talk—she listens and replies."
        onPrimaryAction={() => {
          try {
            sessionStorage.setItem('kira_auto_start', '1');
          } catch {}
        }}
        footer={
          <Link
            href={`/c/${conversationId}`}
            className="text-xs text-cream-300/70 hover:text-cream-100 transition"
          >
            Start new conversation →
          </Link>
        }
      />
    </main>
  );
}
