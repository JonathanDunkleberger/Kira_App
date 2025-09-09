"use client";
import Link from 'next/link';
import { useEffect, useState } from 'react';
import { supaBrowser } from '@/lib/supabase-browser';
import { signOut } from '@/lib/client-api';

type Variant = 'panel' | 'page';

export default function AuthPanel({ variant = 'panel' }: { variant?: Variant }) {
  const supa = supaBrowser();
  const [email, setEmail] = useState<string | null>(null);
  const [hydrated, setHydrated] = useState(false);
  useEffect(() => {
    (async () => {
      const { data } = await supa.auth.getUser();
      setEmail(data.user?.email ?? null);
      setHydrated(true);
    })();
  }, [supa]);

  const shell = variant === 'panel' ? 'px-4 py-3 space-y-4 text-sm' : 'container mx-auto max-w-md py-10 space-y-6 text-sm';
  if (!hydrated) return <div className={shell}>Loading…</div>;

  if (email) {
    return (
      <div className={shell}>
        <h2 className="text-lg font-semibold">Account</h2>
        <p className="text-white/70">Signed in as {email}</p>
        <button
          onClick={() => signOut()}
          className="px-3 py-1.5 rounded-md bg-white/10 hover:bg-white/20 text-xs"
        >
          Sign out
        </button>
      </div>
    );
  }

  return (
    <div className={shell}>
      <h2 className="text-lg font-semibold">Sign in</h2>
      <p className="text-white/70">You need to sign in to access account features.</p>
      <div className="flex gap-2 flex-wrap">
        <Link href="/sign-in" className="px-3 py-1.5 rounded-md bg-primary/20 hover:bg-primary/30 text-primary text-xs">Sign in</Link>
        <Link href="/sign-up" className="px-3 py-1.5 rounded-md bg-white/10 hover:bg-white/20 text-xs">Create account</Link>
      </div>
    </div>
  );
}
