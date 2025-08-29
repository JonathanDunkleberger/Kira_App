'use client';
import Image from 'next/image';
import { useEffect, useState } from 'react';
import { ensureAnonSession, fetchEntitlement, startCheckout, openBillingPortal, signOut } from '@/lib/client-api';
import { supabase } from '@/lib/supabaseClient';

function Pill({ children, kind = 'slate' }: { children: React.ReactNode; kind?: 'slate'|'emerald' }) {
  const map = kind === 'emerald'
    ? 'bg-emerald-900/40 text-emerald-200 border-emerald-700/40'
    : 'bg-slate-900/40 text-slate-300 border-slate-700/40';
  return <span className={`text-xs px-2 py-1 rounded-full border ${map}`}>{children}</span>;
}

export default function Header() {
  const [signedIn, setSignedIn] = useState(false);
  const [status, setStatus] = useState<'inactive'|'active'|'past_due'|'canceled'>('inactive');
  const [seconds, setSeconds] = useState<number | null>(null);

  async function refresh() {
    await ensureAnonSession();
    const { data: { session } } = await supabase.auth.getSession();
    setSignedIn(!!session);
    const ent = await fetchEntitlement();
    if (ent) {
      setStatus(ent.status);
      setSeconds(ent.secondsRemaining);
    }
  }

  useEffect(() => {
    refresh();

    // allow other components to force a refresh when entitlement changes
    const onUpdate = () => refresh();
    window.addEventListener('entitlement:updated', onUpdate);
    document.addEventListener('visibilitychange', () => {
      if (!document.hidden) refresh();
    });
    return () => window.removeEventListener('entitlement:updated', onUpdate);
  }, []);

  const isPro = status === 'active';
  const minutes = typeof seconds === 'number' ? Math.ceil(seconds / 60) : null;

  return (
    <header className="sticky top-0 z-30 backdrop-blur bg-[#0b0b12]/70 border-b border-white/5">
      <div className="mx-auto max-w-5xl px-4 h-14 flex items-center justify-between">
        <div className="flex items-center gap-3">
          <Image src="/logo.png" alt="Kira" width={24} height={24} className="opacity-90" />
          <span className="text-sm text-white/70">Kira</span>
          <Pill>beta</Pill>
        </div>

        <div className="flex items-center gap-3">
          {isPro ? <Pill kind="emerald">Pro</Pill> : <Pill>Free</Pill>}
          {!isPro && minutes !== null && <span className="text-xs text-white/50">{minutes} min left</span>}

          {!signedIn && (
            <button
              onClick={async () => {
                // Anonymous "one-tap" account for MVP; later swap to magic link
                await ensureAnonSession();
                await refresh();
              }}
              className="px-3 py-1.5 rounded-lg bg-white text-black text-sm font-medium hover:opacity-90"
            >
              Sign up
            </button>
          )}

          {signedIn && !isPro && (
            <>
              <button
                onClick={() => startCheckout()}
                className="px-3 py-1.5 rounded-lg bg-fuchsia-600 text-white text-sm font-medium hover:bg-fuchsia-700"
              >
                Upgrade $1.99/mo
              </button>
              <button
                onClick={() => signOut()}
                className="px-3 py-1.5 rounded-lg border border-white/15 text-white/90 text-sm hover:bg-white/5"
              >
                Sign out
              </button>
            </>
          )}

          {signedIn && isPro && (
            <>
              <button
                onClick={() => openBillingPortal()}
                className="px-3 py-1.5 rounded-lg bg-emerald-600 text-white text-sm font-medium hover:bg-emerald-700"
              >
                Manage billing
              </button>
              <button
                onClick={() => signOut()}
                className="px-3 py-1.5 rounded-lg border border-white/15 text-white/90 text-sm hover:bg-white/5"
              >
                Sign out
              </button>
            </>
          )}
        </div>
      </div>
    </header>
  );
}
