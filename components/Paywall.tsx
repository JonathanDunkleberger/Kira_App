'use client';
import Link from 'next/link';
import { startCheckout } from '@/lib/client-api';
import { useEffect, useState } from 'react';
import { supabase } from '@/lib/supabaseClient';
import { getUsageState } from '@/lib/usageTracking';

interface PaywallProps {
  isOpen: boolean;
  onClose: () => void;
}

export default function Paywall({ isOpen, onClose }: PaywallProps) {
  const [signedIn, setSignedIn] = useState(false);
  const [usage, setUsage] = useState(getUsageState());

  useEffect(() => {
    supabase.auth.getSession().then(({ data }) => setSignedIn(!!data.session));
    setUsage(getUsageState());
  }, [isOpen]);

  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 z-50 grid place-items-center bg-black/60 backdrop-blur-sm p-4">
      <div className="w-full max-w-md rounded-2xl border border-white/10 bg-[#12101b] shadow-2xl p-6 text-center">
        <div className="flex items-start justify-between mb-4">
          <h2 className="text-2xl font-semibold">Time's Up for Today</h2>
          <button onClick={onClose} className="text-white/60 hover:text-white p-1" aria-label="Close">
            ✕
          </button>
        </div>

        <div className="mx-auto w-16 h-16 mb-4 rounded-full bg-amber-500/20 flex items-center justify-center">
          <svg xmlns="http://www.w3.org/2000/svg" className="h-8 w-8 text-amber-400" fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z" />
          </svg>
        </div>

        <p className="text-sm text-white/60 mb-6">
          You've used all your free chat minutes for today. Subscribe to continue talking with Kira.
        </p>

        <div className="mb-6 p-4 rounded-lg bg-white/5 border border-white/10">
          <h3 className="font-semibold mb-2">Pro Features</h3>
          <ul className="text-sm text-white/70 space-y-1 text-left">
            <li className="flex items-center gap-2">
              <svg xmlns="http://www.w3.org/2000/svg" className="h-4 w-4 text-emerald-400" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
              </svg>
              <span>Unlimited conversations</span>
            </li>
            <li className="flex items-center gap-2">
              <svg xmlns="http://www.w3.org/2000/svg" className="h-4 w-4 text-emerald-400" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
              </svg>
              <span>Priority access to new features</span>
            </li>
            <li className="flex items-center gap-2">
              <svg xmlns="http://www.w3.org/2000/svg" className="h-4 w-4 text-emerald-400" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
              </svg>
              <span>Cancel anytime</span>
            </li>
          </ul>
        </div>

        {!signedIn ? (
          <div className="space-y-3">
            <Link 
              href="/sign-up?next=upgrade" 
              className="block w-full rounded-lg bg-fuchsia-600 text-white font-medium py-3 hover:bg-fuchsia-700 transition-colors"
            >
              Create Account & Subscribe
            </Link>
            <Link 
              href="/sign-in?next=upgrade" 
              className="block w-full rounded-lg border border-white/15 text-white font-medium py-3 hover:bg-white/5 transition-colors"
            >
              Log In to Continue
            </Link>
            <button onClick={onClose} className="text-sm text-white/60 hover:underline mt-2">
              Maybe later
            </button>
          </div>
        ) : (
          <div className="space-y-3">
            <button 
              onClick={() => startCheckout()} 
              className="w-full rounded-lg bg-fuchsia-600 text-white font-medium py-3 hover:bg-fuchsia-700 transition-colors"
            >
              Upgrade to Pro — $1.99 / mo
            </button>
            <button onClick={onClose} className="text-sm text-white/60 hover:underline">
              Maybe later
            </button>
          </div>
        )}

        <p className="text-[11px] text-white/40 mt-4">
          By subscribing you agree to our Terms of Service and Privacy Policy.
        </p>
      </div>
    </div>
  );
}