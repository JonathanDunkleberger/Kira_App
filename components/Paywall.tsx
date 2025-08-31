"use client";

import Link from 'next/link';
import { startCheckout } from '@/lib/client-api';
import { useConversation } from '@/lib/state/ConversationProvider';
import { usePaywall } from '@/lib/hooks/usePaywall';
import { useEffect, useState } from 'react';
import { trackUpgradeClick, trackPaywallTriggered, PaywallEventProperties } from '@/lib/analytics';

interface PaywallProps {
  isOpen: boolean;
  onClose: () => void;
}

export default function Paywall({ isOpen, onClose }: PaywallProps) {
  const { session, conversationId } = useConversation();
  const { secondsRemaining, isPro, isLoading } = usePaywall();
  const signedIn = !!session;
  const [freeMinutes, setFreeMinutes] = useState<number | null>(null);
  const [timeDisplay, setTimeDisplay] = useState('');
  // Get guest conversation id (if any) to tag auth links
  const guestConversationId = typeof window !== 'undefined' ? sessionStorage.getItem('guestConversationId') : null;
  const signUpHref = `/sign-up?next=upgrade${guestConversationId ? `&guestConvId=${guestConversationId}` : ''}`;
  const signInHref = `/sign-in?next=upgrade${guestConversationId ? `&guestConvId=${guestConversationId}` : ''}`;

  useEffect(() => {
    if (!isOpen) return;
    fetch('/api/config')
      .then(r => r.json())
      .then(cfg => setFreeMinutes(Math.floor(Number(cfg?.freeTrialSeconds ?? 900) / 60)))
      .catch(() => setFreeMinutes(null));
  }, [isOpen]);

  useEffect(() => {
    if (isOpen) {
      const properties: PaywallEventProperties = {
        userId: session?.user?.id,
        userType: session ? 'authenticated' : 'guest',
        plan: isPro ? 'pro' : 'free',
        secondsRemaining: secondsRemaining ?? undefined,
        conversationId: conversationId || undefined,
        source: 'time_exhaustion',
      };
      trackPaywallTriggered(properties);
    }
  }, [isOpen, session, isPro, secondsRemaining, conversationId]);

  useEffect(() => {
    if (secondsRemaining !== null) {
      const minutes = Math.floor(secondsRemaining / 60);
      const seconds = secondsRemaining % 60;
      setTimeDisplay(`${minutes}:${seconds.toString().padStart(2, '0')}`);
    }
  }, [secondsRemaining]);

  const handleUpgradeClick = () => {
    const properties: PaywallEventProperties = {
      userId: session?.user?.id,
      userType: session ? 'authenticated' : 'guest',
      plan: 'free',
      secondsRemaining: secondsRemaining ?? undefined,
      conversationId: conversationId || undefined,
      source: 'paywall_button',
    };
    trackUpgradeClick(properties);
    startCheckout();
  };

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

  {freeMinutes !== null && (
          <div className="mb-4 p-3 bg-rose-900/20 border border-rose-700/30 rounded-lg">
            <p className="text-sm text-rose-200 text-center">
              You've used all your {freeMinutes} free minutes for today
            </p>
          </div>
        )}

        <div className="space-y-3">
          {signedIn ? (
            <button onClick={handleUpgradeClick} className="w-full rounded-lg bg-fuchsia-600 text-white font-medium py-3 hover:bg-fuchsia-700">
              Upgrade to Pro — $1.99 / mo
            </button>
          ) : (
            <>
              <Link href={signUpHref} onClick={handleUpgradeClick} className="block w-full rounded-lg bg-fuchsia-600 text-white font-medium py-3 hover:bg-fuchsia-700">
              Create Account & Subscribe
              </Link>
              <Link href={signInHref} onClick={handleUpgradeClick} className="block w-full rounded-lg border border-white/15 text-white font-medium py-3 hover:bg-white/5">
                Log In to Continue
              </Link>
            </>
          )}
          <button onClick={onClose} className="text-sm text-white/60 hover:underline">
            Maybe later
          </button>
        </div>
        {!isLoading && secondsRemaining !== null && secondsRemaining > 0 && (
          <div className="mt-4 text-xs text-white/40">
            {Math.floor(secondsRemaining / 60)} minutes remaining today
          </div>
        )}
      </div>
    </div>
  );
}