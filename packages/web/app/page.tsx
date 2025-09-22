// packages/web/app/page.tsx
'use client';

import { useCallback } from 'react';
import { useRouter } from 'next/navigation';
import { useUser } from '@clerk/nextjs';
import { Phone } from 'lucide-react';

// Helper function to get a greeting based on the time of day
function getGreeting() {
  const hour = new Date().getHours();
  if (hour < 12) return 'Morning';
  if (hour < 18) return 'Afternoon';
  return 'Evening';
}

export default function HomePage() {
  const router = useRouter();
  const { user } = useUser();

  // For now, we use the user's first name from Clerk.
  // In Phase 2, we'll use the preferred name from our database.
  const displayName = user?.firstName || '';
  const greeting = getGreeting();

  const startConversation = useCallback(() => {
    const id = crypto.randomUUID();
    router.push(`/chat/${id}`);
  }, [router]);

  return (
    <main className="flex min-h-screen w-full flex-col items-center justify-center p-4">
      <div className="w-full max-w-xs text-center">
        <h1 className="mb-8 text-2xl font-medium text-neutral-800 dark:text-neutral-200">
          {greeting}{displayName ? `, ${displayName}` : ''}
        </h1>
        <button
          onClick={startConversation}
          className="group flex w-full cursor-pointer flex-col items-center justify-center rounded-xl border border-black/10 bg-[#e4e4d7]/50 p-8 text-xl font-medium text-[#3b3a33] transition-all hover:border-black/20 hover:shadow-md dark:border-white/10 dark:bg-[#41403a]/50 dark:text-[#e4e2d7] dark:hover:border-white/20"
          aria-label="Talk to Kira"
        >
          <div className="flex items-center gap-3">
            <Phone size={22} />
            <span>Kira</span>
          </div>
        </button>
      </div>
    </main>
  );
}
