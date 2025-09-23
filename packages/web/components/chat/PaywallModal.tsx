'use client';
import React from 'react';

interface PaywallModalProps {
  reason: string | null;
  onUpgrade?: () => void;
  onClose?: () => void;
  isPro?: boolean;
}

const reasonCopy = {
  daily_limit: {
    title: 'Daily Limit Reached',
    body: "You've hit today's free talking time. Upgrade to keep the conversation going without interruptions.",
    cta: 'Upgrade to Pro',
  },
  daily_limit_exceeded: {
    title: 'Daily Limit Reached',
    body: "You've hit today's free talking time. Upgrade to keep the conversation going without interruptions.",
    cta: 'Upgrade to Pro',
  },
  session_limit: {
    title: 'Session Limit Reached',
    body: "You've reached the maximum session duration. Upgrade for extended, uninterrupted sessions.",
    cta: 'Upgrade to Pro',
  },
  session_limit_exceeded: {
    title: 'Session Limit Reached',
    body: "You've reached the maximum session duration. Upgrade for extended, uninterrupted sessions.",
    cta: 'Upgrade to Pro',
  },
  limit: {
    title: 'Limit Reached',
    body: "You've reached a usage limit. Upgrade to continue.",
    cta: 'Upgrade',
  },
} as const;

export function PaywallModal({ reason, onUpgrade, onClose, isPro }: PaywallModalProps) {
  if (!reason || isPro) return null;
  const copyKey = (reason in reasonCopy ? reason : 'limit') as keyof typeof reasonCopy;
  const copy = reasonCopy[copyKey];
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm">
      <div className="w-full max-w-md rounded-xl border border-white/10 bg-neutral-900 p-6 shadow-xl">
        <h2 className="text-xl font-semibold mb-2 text-white">{copy.title}</h2>
        <p className="text-sm text-neutral-300 mb-4 leading-relaxed">{copy.body}</p>
        <div className="flex gap-3 justify-end">
          {onClose && (
            <button
              onClick={onClose}
              className="px-4 py-2 rounded-md text-sm bg-neutral-700 hover:bg-neutral-600 text-white transition"
            >
              Close
            </button>
          )}
          <button
            onClick={onUpgrade}
            className="px-4 py-2 rounded-md text-sm font-medium bg-gradient-to-r from-pink-500 to-orange-500 hover:from-pink-400 hover:to-orange-400 text-white shadow focus:outline-none focus:ring-2 focus:ring-pink-400"
          >
            {copy.cta}
          </button>
        </div>
      </div>
    </div>
  );
}

export default PaywallModal;
