'use client';
import { useEffect } from 'react';
import { useRouter } from 'next/navigation';

export const dynamic = 'force-dynamic';

export default function ChatPage() {
  const router = useRouter();
  useEffect(() => {
    const id =
      typeof crypto !== 'undefined' && 'randomUUID' in crypto
        ? crypto.randomUUID()
        : Math.random().toString(36).slice(2) + Date.now().toString(36);
    router.replace(`/chat/${id}`);
  }, [router]);
  return (
    <main className="min-h-[100dvh] pt-14 flex items-center justify-center">
      <span className="text-sm text-neutral-500">Redirecting…</span>
    </main>
  );
}
