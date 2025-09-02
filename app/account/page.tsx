'use client';
import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { useConversation } from '@/lib/state/ConversationProvider';
import { openBillingPortal, signOut, clearAllConversations } from '@/lib/client-api';

export default function AccountPage() {
  const router = useRouter();
  const { session, isPro, dailySecondsRemaining, promptPaywall } = useConversation();
  // Hydration flag to avoid redirecting before provider sets session
  const [hydrated, setHydrated] = useState(false);
  useEffect(() => { setHydrated(true); }, []);
  useEffect(() => {
    if (!hydrated) return;
    if (!session) router.push('/sign-up');
  }, [hydrated, session, router]);
  const email = session?.user?.email ?? null;
  const plan = isPro ? 'supporter' : 'free' as const;
  const status = isPro ? 'active' : 'inactive' as const;
  const seconds = dailySecondsRemaining ?? 0;

  // Avoid flash of incorrect UI while redirecting
  if (!hydrated || !session) return null;

  return (
    <main className="min-h-screen bg-[#0b0b12] text-white grid place-items-center px-4">
      <div className="w-full max-w-lg rounded-2xl border border-white/10 bg-[#12101b] p-6 shadow-2xl">
        <h1 className="text-2xl font-semibold">Your account</h1>
        <div className="mt-4 space-y-2 text-sm text-white/80">
          <div><span className="text-white/50">Email:</span> {email ?? '—'}</div>
          <div><span className="text-white/50">Plan:</span> {plan === 'supporter' ? 'Pro' : 'Free'}</div>
          <div><span className="text-white/50">Status:</span> {status}</div>
          {!isPro && <div><span className="text-white/50">Trial minutes left:</span> {Math.ceil(seconds/60)}</div>}
        </div>

        <div className="mt-6 flex gap-3 flex-wrap">
          {isPro ? (
            <button onClick={() => openBillingPortal()}
              className="px-4 py-2 rounded-lg bg-emerald-600 hover:bg-emerald-700">
              Manage billing
            </button>
          ) : (
            <button 
              onClick={() => promptPaywall('proactive_click')}
              className="px-4 py-2 rounded-lg bg-fuchsia-600 hover:bg-fuchsia-700"
            >
              Upgrade
            </button>
          )}
          <button onClick={() => signOut()}
            className="px-4 py-2 rounded-lg border border-white/15 hover:bg-white/5">
            Sign out
          </button>
        </div>

        {/* Clear chat history */}
        <div className="mt-8 border-t border-red-500/20 pt-4">
          <button 
            onClick={clearAllConversations}
            className="px-4 py-2 text-sm rounded-lg border border-red-500/30 text-red-400 hover:bg-red-500/10 hover:text-red-300"
          >
            Clear Chat History
          </button>
          <p className="text-xs text-white/50 mt-2">Permanently delete all of your conversations.</p>
        </div>
      </div>
    </main>
  );
}
