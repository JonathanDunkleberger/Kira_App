'use client';
import Image from 'next/image';
import Link from 'next/link';
import { useEffect, useRef, useState } from 'react';
import { startCheckout, openBillingPortal, signOut } from '@/lib/client-api';
import { supabase } from '@/lib/supabaseClient';
import { useConversation } from '@/lib/state/ConversationProvider';

function Pill({ children, kind = 'slate' }: { children: React.ReactNode; kind?: 'slate'|'emerald' }) {
  const map = kind === 'emerald'
    ? 'bg-emerald-900/40 text-emerald-200 border-emerald-700/40'
    : 'bg-slate-900/40 text-slate-300 border-slate-700/40';
  return <span className={`text-xs px-2 py-1 rounded-full border ${map}`}>{children}</span>;
}

export default function Header() {
  const [email, setEmail] = useState<string | null>(null);
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  const { isPro, dailySecondsRemaining, conversationStatus, secondsRemaining, promptPaywall } = useConversation();

  async function refresh() {
    const { data: { session} } = await supabase.auth.getSession();
    setEmail(session?.user?.email ?? null);
  }

  useEffect(() => {
    refresh();
    const onUpdate = () => refresh();
    window.addEventListener('entitlement:updated', onUpdate);
    document.addEventListener('click', (e) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    });
    return () => window.removeEventListener('entitlement:updated', onUpdate);
  }, []);

  const signedIn = !!email;
  const sessionTimerText = (() => {
    const s = Math.max(0, Number(secondsRemaining || 0));
    const m = Math.floor(s / 60);
    const r = s % 60;
    return `${m}:${r < 10 ? '0' : ''}${r} left`;
  })();
  const minutes = typeof dailySecondsRemaining === 'number' ? Math.ceil(dailySecondsRemaining / 60) : null;

  return (
    <header className="sticky top-0 z-30 backdrop-blur bg-[#0b0b12]/70 border-b border-white/5">
      <div className="mx-auto max-w-5xl px-4 h-14 flex items-center justify-between">
        <div className="flex items-center gap-3">
          <Link href="/"><Image src="/logo.png" alt="Kira" width={24} height={24} className="opacity-90" /></Link>
          <span className="text-sm text-white/70">Kira</span>
          <Pill>beta</Pill>
        </div>

        <div className="flex items-center gap-3">
          {!isPro && (
            <button
              onClick={promptPaywall}
              className="px-3 py-1.5 rounded-lg bg-fuchsia-600 text-white text-sm font-medium hover:bg-fuchsia-700"
            >
              Subscribe
            </button>
          )}
          {isPro ? <Pill kind="emerald">Pro</Pill> : <Pill>Free</Pill>}
          {/* Case 1: Pro user in an active conversation */}
          {isPro && conversationStatus === 'active' && (
            <span className="text-xs text-white/50">{sessionTimerText}</span>
          )}
          {/* Case 2: Free user always shows daily remaining */}
          {!isPro && minutes !== null && (
            <span className="text-xs text-white/50">{minutes}m left today</span>
          )}

          {!signedIn ? (
            <>
              <Link href="/sign-in" className="px-3 py-1.5 rounded-lg border border-white/15 text-white/90 text-sm hover:bg-white/5">Log in</Link>
              <Link href="/sign-up" className="px-3 py-1.5 rounded-lg bg-white text-black text-sm font-medium hover:opacity-90">Sign up</Link>
            </>
          ) : (
            <>
              {!isPro && (
                <button
                  onClick={() => startCheckout()}
                  className="px-3 py-1.5 rounded-lg bg-fuchsia-600 text-white text-sm font-medium hover:bg-fuchsia-700"
                >
                  Upgrade $1.99/mo
                </button>
              )}
              <div className="relative" ref={ref}>
                <button onClick={() => setOpen(v => !v)}
                        className="h-9 w-9 rounded-full bg-white/10 border border-white/15 grid place-items-center">
                  <span className="text-xs">{email?.[0]?.toUpperCase() ?? 'U'}</span>
                </button>
                {open && (
                  <div className="absolute right-0 mt-2 w-44 rounded-xl border border-white/10 bg-[#12101b] p-1 shadow-xl">
                    <Link href="/account" className="block px-3 py-2 text-sm text-white/90 rounded-lg hover:bg-white/5">Account</Link>
                    {isPro && (
                      <button onClick={() => openBillingPortal()} className="w-full text-left px-3 py-2 text-sm text-white/90 rounded-lg hover:bg-white/5">
                        Manage billing
                      </button>
                    )}
                    <button onClick={() => signOut()} className="w-full text-left px-3 py-2 text-sm text-white/90 rounded-lg hover:bg-white/5">
                      Sign out
                    </button>
                  </div>
                )}
              </div>
            </>
          )}
        </div>
      </div>
    </header>
  );
}
