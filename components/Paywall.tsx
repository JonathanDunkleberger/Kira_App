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

        <div className="mx-auto w-16 h-16 mb-4 rounded-full bg-amber-500/20 flex items-center justify-center">
          <svg xmlns="http://www.w3.org/2000/svg" className="h-8 w-8 text-amber-400" fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z" />
          </svg>
        </div>

        <h2 className="text-2xl font-semibold mt-1">Daily Limit Reached</h2>
        <p className="text-sm text-white/60 mt-1">You've used all your free chat minutes for today.</p>

        <div className="mt-6 space-y-2 text-sm text-white/70 text-left mx-auto w-fit">
          <div className="flex items-center gap-2">
            <svg xmlns="http://www.w3.org/2000/svg" className="h-4 w-4 text-emerald-400" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
            </svg>
            <span>Unlimited chats with Pro</span>
          </div>
          <div className="flex items-center gap-2">
            <svg xmlns="http://www.w3.org/2000/svg" className="h-4 w-4 text-emerald-400" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
            </svg>
            <span>Priority access</span>
          </div>
          <div className="flex items-center gap-2">
            <svg xmlns="http://www.w3.org/2000/svg" className="h-4 w-4 text-emerald-400" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
            </svg>
            <span>Cancel anytime</span>
          </div>
        </div>

        {!signedIn ? (
          <div className="mt-6 grid gap-3">
            <Link 
              href="/sign-up?next=upgrade" 
              className="w-full rounded-lg bg-fuchsia-600 text-white font-medium py-3 hover:bg-fuchsia-700 transition-colors"
            >
              Create Account & Subscribe
            </Link>
            <div className="relative flex items-center py-2">
              <div className="flex-grow border-t border-white/10"></div>
              <span className="flex-shrink mx-4 text-white/40 text-xs">or</span>
              <div className="flex-grow border-t border-white/10"></div>
            </div>
            <Link 
              href="/sign-in?next=upgrade" 
              className="w-full rounded-lg border border-white/15 text-white font-medium py-3 hover:bg-white/5 transition-colors"
            >
              Log In to Continue
            </Link>
            <button onClick={() => setIsVisible(false)} className="text-sm text-white/60 mt-2 hover:underline">
              Maybe later
            </button>
          </div>
        ) : (
          <>
            <button 
              onClick={() => startCheckout()} 
              className="mt-6 w-full rounded-lg bg-fuchsia-600 text-white font-medium py-3 hover:bg-fuchsia-700 transition-colors"
            >
              Upgrade to Pro — $1.99 / mo
            </button>
            <button onClick={() => setIsVisible(false)} className="text-sm text-white/60 mt-2 hover:underline">
              Maybe later
            </button>
          </>
        )}

        <p className="text-[11px] text-white/40 mt-3">By subscribing you agree to our Terms & Privacy Policy.</p>
      </div>
    </div>
  );
}