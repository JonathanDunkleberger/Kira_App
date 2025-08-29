'use client';
import { startCheckout, ensureAnonSession } from '@/lib/client-api';
import { useEffect, useState } from 'react';

export default function Paywall() {
  const [isVisible, setIsVisible] = useState(true);

  useEffect(() => {
    // make sure we have an anonymous account before we send to checkout
    ensureAnonSession().catch(() => {});
  }, []);

  if (!isVisible) return null;

  return (
    <div className="fixed inset-0 z-50 grid place-items-center bg-black/60 backdrop-blur-sm p-4">
      <div className="w-full max-w-md rounded-2xl border border-white/10 bg-[#12101b] shadow-2xl p-6 text-center">
        <div className="flex items-start justify-end">
          <button
            onClick={() => setIsVisible(false)}
            className="text-white/60 hover:text-white"
            aria-label="Close"
          >✕</button>
        </div>

        <h2 className="text-2xl font-semibold mt-1">Trial ended</h2>
        <p className="text-sm text-white/60 mt-1">Subscribe to continue the conversation without limits.</p>

        <div className="mt-6 space-y-2 text-sm text-white/70 text-left mx-auto w-fit">
          <div>• Unlimited chats & audio</div>
          <div>• Priority latency</div>
          <div>• Cancel anytime</div>
        </div>

        <button
          onClick={() => startCheckout()}
          className="mt-6 w-full rounded-lg bg-fuchsia-600 text-white font-medium py-3 hover:bg-fuchsia-700"
        >
          Create account & Upgrade — $1.99 / mo
        </button>

        <p className="text-[11px] text-white/40 mt-3">By subscribing you agree to the Terms & Privacy.</p>
      </div>
    </div>
  );
}