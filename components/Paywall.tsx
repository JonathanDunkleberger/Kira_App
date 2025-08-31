"use client";

import Link from 'next/link';
import { startCheckout } from '@/lib/client-api';
import { useConversation } from '@/lib/state/ConversationProvider';

interface PaywallProps {
  isOpen: boolean;
  onClose: () => void;
}

export default function Paywall({ isOpen, onClose }: PaywallProps) {
  const { session } = useConversation();
  const signedIn = !!session;

  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 z-50 grid place-items-center bg-black/60 backdrop-blur-sm p-4">
      <div className="w-full max-w-md rounded-2xl border border-white/10 bg-[#12101b] shadow-2xl p-6 text-center">
        <h2 className="text-2xl font-semibold">Time's Up for Today</h2>
        <p className="text-sm text-white/60 my-4">
          You've used all your free chat time. Subscribe to continue talking with Kira.
        </p>

        <div className="mb-6 p-4 rounded-lg bg-white/5 border border-white/10 text-left">
          <h3 className="font-semibold mb-2 text-center">Pro Features</h3>
          <ul className="text-sm text-white/70 space-y-1">
            {/* Add or customize your Pro feature bullets here if desired */}
          </ul>
        </div>

        <div className="space-y-3">
          {signedIn ? (
            <button onClick={startCheckout} className="w-full rounded-lg bg-fuchsia-600 text-white font-medium py-3 hover:bg-fuchsia-700">
              Upgrade to Pro — $1.99 / mo
            </button>
          ) : (
            <Link href="/sign-up?next=upgrade" className="block w-full rounded-lg bg-fuchsia-600 text-white font-medium py-3 hover:bg-fuchsia-700">
              Create Account & Subscribe
            </Link>
          )}
          <button onClick={onClose} className="text-sm text-white/60 hover:underline">
            Maybe later
          </button>
        </div>
      </div>
    </div>
  );
}