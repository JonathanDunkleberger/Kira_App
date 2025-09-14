'use client';
import { useCallback } from 'react';
import { useRouter } from 'next/navigation';

import { Card, CardHeader, CardTitle, CardDescription, CardContent } from '../components/ui/card';

export default function HomePage() {
  const router = useRouter();

  const startConversation = useCallback(() => {
    const id = crypto.randomUUID();
    router.push(`/c/${id}`);
  }, [router]);

  return (
    <main className="min-h-[calc(100vh-56px)] flex items-center justify-center p-6">
      <button
        onClick={startConversation}
        className="group w-full max-w-sm focus:outline-none"
        aria-label="Talk to Kira"
      >
        <Card className="cursor-pointer border border-black/10 dark:border-white/10 hover:shadow-lg transition-all bg-white/70 dark:bg-neutral-900/60 backdrop-blur-sm">
          <CardHeader className="space-y-3 py-10 flex items-center justify-center text-center">
            <div className="w-14 h-14 rounded-full bg-amber-200/60 dark:bg-amber-400/10 flex items-center justify-center shadow-inner">
              <span className="text-2xl">📞</span>
            </div>
            <CardTitle className="text-2xl font-semibold tracking-tight">Talk to Kira</CardTitle>
            <CardDescription className="text-sm max-w-[18ch] mx-auto">
              Start a real-time voice session instantly.
            </CardDescription>
            <CardContent className="p-0">
              <div className="text-xs text-neutral-500 dark:text-neutral-400 group-hover:underline">
                Tap to begin →
              </div>
            </CardContent>
          </CardHeader>
        </Card>
      </button>
    </main>
  );
}
