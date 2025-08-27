"use client";
import { startCheckout } from '@/lib/client-api';

export default function Paywall({ onUnlock }: { onUnlock?: () => void }) {
  return (
    <div className="rounded-xl border border-purple-700/40 bg-purple-900/10 p-4 text-gray-100 text-center">
      <p className="mb-3">Your 20‑minute trial is over.</p>
      <button
        onClick={() => (onUnlock ? onUnlock() : startCheckout())}
        className="px-4 py-2 rounded-md bg-purple-600 text-white"
      >
        Unlock for $1.99
      </button>
    </div>
  );
}
