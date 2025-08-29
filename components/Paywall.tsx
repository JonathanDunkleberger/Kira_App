"use client";
import { startCheckout } from '@/lib/client-api';
import { useState } from 'react';

export default function Paywall() {
  const [isVisible, setIsVisible] = useState(true);
  if (!isVisible) return null;

  return (
    <div className="fixed inset-0 z-50 grid place-items-center bg-black/60 backdrop-blur-sm p-4">
      <div className="w-full max-w-md rounded-2xl border border-white/10 bg-[#12101b] shadow-2xl">
        <div className="p-6">
          <div className="flex items-start justify-between">
            <div>
              <h2 className="text-xl font-semibold">Trial ended</h2>
              <p className="text-sm text-white/60 mt-1">Subscribe to continue the conversation without limits.</p>
            </div>
            <button
              onClick={() => setIsVisible(false)}
              className="text-white/60 hover:text-white"
              aria-label="Close"
            >✕</button>
          </div>

          <div className="mt-6 space-y-2 text-sm text-white/70">
            <div>• Unlimited chats & audio</div>
            <div>• Priority latency</div>
            <div>• Cancel anytime</div>
          </div>

          <button
            onClick={() => startCheckout()}
            className="mt-6 w-full rounded-lg bg-fuchsia-600 text-white font-medium py-3 hover:bg-fuchsia-700"
          >
            Upgrade — $1.99 / mo
          </button>
          <p className="text-[11px] text-white/40 mt-3">By subscribing you agree to the Terms & Privacy.</p>
        </div>
      </div>
    </div>
  );
}