'use client';
import { useConversation } from '@/lib/state/ConversationProvider';
import { openBillingPortal, signOut } from '@/lib/client-api';

export default function AccountPage() {
  const { session, isPro, dailySecondsRemaining } = useConversation();
  const email = session?.user?.email ?? null;
  const plan = isPro ? 'supporter' : 'free' as const;
  const status = isPro ? 'active' : 'inactive' as const;
  const seconds = dailySecondsRemaining ?? 0;

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

        <div className="mt-6 flex gap-3">
          {isPro ? (
            <button onClick={() => openBillingPortal()}
              className="px-4 py-2 rounded-lg bg-emerald-600 hover:bg-emerald-700">
              Manage billing
            </button>
          ) : (
            <a href="/?next=upgrade" className="px-4 py-2 rounded-lg bg-fuchsia-600 hover:bg-fuchsia-700">
              Upgrade
            </a>
          )}
          <button onClick={() => signOut()}
            className="px-4 py-2 rounded-lg border border-white/15 hover:bg-white/5">
            Sign out
          </button>
        </div>
      </div>
    </main>
  );
}
