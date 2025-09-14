'use client';
import { useRouter } from 'next/navigation';
import { useState } from 'react';
import { Button } from './ui/Button';

export function HomeCard() {
  const router = useRouter();
  const [loading, setLoading] = useState(false);
  async function start() {
    setLoading(true);
    try {
      // minimal: request a new conversation via server or just client id path
      const id = crypto.randomUUID();
      router.push(`/c/${id}`);
    } finally {
      setLoading(false);
    }
  }
  return (
    <div className="w-full max-w-md mx-auto mt-24 p-8 rounded-2xl border border-black/10 dark:border-white/10 bg-[var(--surface)] shadow">
      <h1 className="text-2xl font-semibold tracking-tight text-[var(--text)] mb-2">Talk to Kira</h1>
      <p className="text-sm text-[var(--muted-text)] mb-6">Start a real-time voice + text conversation.</p>
      <Button onClick={start} disabled={loading} className="w-full">
        {loading ? 'Starting…' : 'Start Conversation'}
      </Button>
    </div>
  );
}
