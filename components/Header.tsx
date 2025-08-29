'use client';
import Image from 'next/image';
import { useEffect, useState } from 'react';
import { ensureAnonSession, fetchSessionSeconds, startCheckout, openBillingPortal, signOut } from '@/lib/client-api';
import { supabase } from '@/lib/supabaseClient';

function Pill({ children, kind = 'slate' }: { children: React.ReactNode; kind?: 'slate'|'emerald' }) {
  const map = kind === 'emerald'
    ? 'bg-emerald-900/40 text-emerald-200 border-emerald-700/40'
    : 'bg-slate-900/40 text-slate-300 border-slate-700/40';
  return <span className={`text-xs px-2 py-1 rounded-full border ${map}`}>{children}</span>;
}

export default function Header() {
  const [signedIn, setSignedIn] = useState(false);
  const [seconds, setSeconds] = useState<number | null>(null);
  const [email, setEmail] = useState<string | null>(null);

  useEffect(() => {
    (async () => {
      await ensureAnonSession();
      const { data: { session } } = await supabase.auth.getSession();
      setSignedIn(!!session);
      setEmail(session?.user?.email ?? null);
      const s = await fetchSessionSeconds().catch(() => null);
      setSeconds(s);
    })();
  }, []);

  const isPro = typeof seconds === 'number' && seconds > 100000000;
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
                alert('You are in anonymous mode. Add magic link later for real accounts.');
              }}
              className="px-3 py-1.5 rounded-lg bg-white text-black text-sm font-medium hover:opacity-90"
            >
              Sign in
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
