'use client';
import { useEffect, useState } from 'react';
import { useConversation } from '@/lib/state/ConversationProvider';
import { openBillingPortal, startCheckout } from '@/lib/client-api';

type Variant = 'panel' | 'page';

export default function BillingPanel({ variant = 'panel' }: { variant?: Variant }) {
  const { session, isPro, dailySecondsRemaining } = useConversation();
  const [hydrated, setHydrated] = useState(false);
  useEffect(() => setHydrated(true), []);
  const seconds = dailySecondsRemaining ?? 0;

  const shell =
    variant === 'panel'
      ? 'px-4 py-3 space-y-4 text-sm'
      : 'container mx-auto max-w-3xl py-10 space-y-6 text-sm';
  if (!hydrated) return <div className={shell}>Loading…</div>;

  return (
    <div className={shell}>
      <h2 className="text-lg font-semibold">Billing</h2>
      <div className="space-y-2 text-white/70">
        {session ? (
          <>
            <div>Email: (unavailable)</div>
            <div>Status: {isPro ? 'Pro' : 'Free'}</div>
            {!isPro && <div>Trial minutes left: {Math.ceil(seconds / 60)}</div>}
          </>
        ) : (
          <div>Please sign in to manage billing.</div>
        )}
      </div>
      {session && (
        <div className="flex gap-2 flex-wrap">
          {isPro ? (
            <button
              onClick={() => openBillingPortal()}
              className="px-3 py-1.5 rounded-md bg-emerald-600 hover:bg-emerald-700 text-xs"
            >
              Manage Portal
            </button>
          ) : (
            <button
              onClick={() => startCheckout()}
              className="px-3 py-1.5 rounded-md bg-fuchsia-600 hover:bg-fuchsia-700 text-xs"
            >
              Upgrade
            </button>
          )}
        </div>
      )}
    </div>
  );
}
