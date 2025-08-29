'use client';
import Link from 'next/link';
import { startCheckout } from '@/lib/client-api';
import { useEffect, useState } from 'react';
import { supabase } from '@/lib/supabaseClient';

export default function Paywall() {
  const [isVisible, setIsVisible] = useState(true);
  const [signedIn, setSignedIn] = useState(false);

  useEffect(() => {
    supabase.auth.getSession().then(({ data }) => setSignedIn(!!data.session));
  }, []);

  if (!isVisible) return null;

  return (
    <div className="fixed inset-0 z-50 grid place-items-center bg-black/60 backdrop-blur-sm p-4">
      <div className="w-full max-w-md rounded-2xl border border-white/10 bg-[#12101b] shadow-2xl p-6 text-center">
        <div className="flex items-start justify-end">
          <button onClick={() => setIsVisible(false)} className="text-white/60 hover:text-white" aria-label="Close">✕</button>
        </div>

        <h2 className="text-2xl font-semibold mt-1">Trial ended</h2>
        <p className="text-sm text-white/60 mt-1">Subscribe to continue the conversation without limits.</p>

        <div className="mt-6 space-y-2 text-sm text-white/70 text-left mx-auto w-fit">
          <div>• Unlimited chats & audio</div>
          <div>• Priority latency</div>
          <div>• Cancel anytime</div>
        </div>

        {!signedIn ? (
          <div className="mt-6 grid gap-2">
            <Link href="/sign-up?next=upgrade" className="w-full rounded-lg bg-white text-black font-medium py-3 hover:opacity-90">
              Create account
            </Link>
            <Link href="/sign-in?next=upgrade" className="w-full rounded-lg border border-white/15 text-white font-medium py-3 hover:bg-white/5">
              Log in
            </Link>
            <button onClick={() => setIsVisible(false)} className="text-sm text-white/60 mt-2 hover:underline">
              Return to home
            </button>
          </div>
        ) : (
          <>
            <button onClick={() => startCheckout()} className="mt-6 w-full rounded-lg bg-fuchsia-600 text-white font-medium py-3 hover:bg-fuchsia-700">
              Upgrade — $1.99 / mo
            </button>
            <button onClick={() => setIsVisible(false)} className="text-sm text-white/60 mt-2 hover:underline">
              Return to home
            </button>
          </>
        )}

        <p className="text-[11px] text-white/40 mt-3">By subscribing you agree to the Terms & Privacy.</p>
      </div>
    </div>
  );
}