'use client';
import Image from 'next/image';
import Link from 'next/link';
import { useEffect, useRef, useState } from 'react';
import { openBillingPortal, signOut } from '@/lib/client-api';
import HeaderUsageIndicator from '@/components/HeaderUsageIndicator';
import { supabase } from '@/lib/supabaseClient';
import { useConversation } from '@/lib/state/ConversationProvider';
import UserProfile from '@/components/UserProfile';

function Pill({ children, kind = 'slate' }: { children: React.ReactNode; kind?: 'slate'|'emerald' }) {
  const map = kind === 'emerald'
    ? 'bg-emerald-900/40 text-emerald-200 border-emerald-700/40'
    : 'bg-slate-900/40 text-slate-300 border-slate-700/40';
  return <span className={`text-xs px-2 py-1 rounded-full border ${map}`}>{children}</span>;
}

export default function Header() {
  const [email, setEmail] = useState<string | null>(null);
  const { isPro } = useConversation();

  async function refresh() {
    const { data: { session} } = await supabase.auth.getSession();
    setEmail(session?.user?.email ?? null);
  }

  useEffect(() => {
    refresh();
    const onUpdate = () => refresh();
    window.addEventListener('entitlement:updated', onUpdate);
  return () => window.removeEventListener('entitlement:updated', onUpdate);
  }, []);

  const signedIn = !!email;
  // Countdown/CTA handled by HeaderUsageIndicator

  return (
    <header className="sticky top-0 z-30 backdrop-blur bg-[#0b0b12]/70 border-b border-white/5 w-full">
      <div className="px-4 md:px-6 h-14 flex items-center justify-between">
        <div className="flex items-center gap-3">
          <Link href="/"><Image src="/logo.png" alt="Kira" width={24} height={24} className="opacity-90" /></Link>
          <span className="text-sm text-white/70">Kira</span>
          <Pill>beta</Pill>
        </div>

        <div className="flex items-center gap-3">
          {/* Countdown/CTA lives in HeaderUsageChip to avoid duplicates */}

          {!signedIn ? (
            <>
              <HeaderUsageIndicator />
              <Link href="/sign-in" className="px-3 py-1.5 rounded-lg border border-white/15 text-white/90 text-sm hover:bg-white/5">Log in</Link>
              <Link href="/sign-up" className="px-3 py-1.5 rounded-lg bg-white text-black text-sm font-medium hover:opacity-90">Sign up</Link>
            </>
          ) : (
            <>
              <HeaderUsageIndicator />
              <UserProfile />
            </>
          )}
        </div>
      </div>
    </header>
  );
}
