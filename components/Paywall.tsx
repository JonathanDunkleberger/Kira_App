'use client';

import Link from 'next/link';
import { useEffect, useMemo, useState } from 'react';

import { startCheckout } from '@/lib/client-api';
import { useConversation } from '@/lib/state/ConversationProvider';
import {
  trackUpgradeClick,
  trackPaywallTriggered,
  trackPaywallDismissed,
  PaywallEventProperties,
} from '@/lib/analytics';

interface PaywallProps {}

export default function Paywall({}: PaywallProps) {
  const {
    session,
    conversationId,
    isPro,
    dailySecondsRemaining,
    dailyLimitSeconds,
    paywallSource,
    closePaywall,
  } = useConversation();
  const signedIn = !!session;
  const totalMinutes = useMemo(() => {
    const lim = dailyLimitSeconds;
    if (!Number.isFinite(lim) || lim <= 0) return null;
    return Math.floor(lim / 60);
  }, [dailyLimitSeconds]);
  const [isLoadingCheckout, setIsLoadingCheckout] = useState(false);
  const [price, setPrice] = useState('...');
  // Get unified guest id (if any) to tag auth links
  const kiraGuestId =
    typeof window !== 'undefined'
      ? localStorage.getItem('kiraGuestId') ||
        localStorage.getItem('guestConversationId') ||
        localStorage.getItem('kira_guest_id')
      : null;
  const signUpHref = `/sign-up?next=upgrade${kiraGuestId ? `&guestConvId=${kiraGuestId}` : ''}`;
  const signInHref = `/sign-in?next=upgrade${kiraGuestId ? `&guestConvId=${kiraGuestId}` : ''}`;

  // All time data now comes from useEntitlement; no local/config fallbacks.

  const isOpen = paywallSource !== null;

  // Auto-dismiss if the user becomes Pro while the paywall is open
  useEffect(() => {
    if (isOpen && isPro) closePaywall();
  }, [isOpen, isPro, closePaywall]);

  // Fetch dynamic price when opening the paywall
  useEffect(() => {
    if (isOpen) {
      fetch('/api/stripe/price')
        .then((res) => res.json())
        .then((data) => {
          if (data?.displayPrice) setPrice(data.displayPrice);
          else setPrice('$4.99/mo');
        })
        .catch(() => setPrice('$4.99/mo'));
    }
  }, [isOpen]);

  useEffect(() => {
    if (isOpen) {
      const properties: PaywallEventProperties = {
        userId: session?.user?.id,
        userType: session ? 'authenticated' : 'guest',
        plan: isPro ? 'pro' : 'free',
        secondsRemaining: dailySecondsRemaining ?? undefined,
        conversationId: conversationId || undefined,
        source: paywallSource || undefined,
      };
      trackPaywallTriggered(properties);
    }
  }, [isOpen, session, isPro, dailySecondsRemaining, conversationId, paywallSource]);

  // No local time formatting state; render directly from provider values when needed.

  const handleUpgradeClick = () => {
    const properties: PaywallEventProperties = {
      userId: session?.user?.id,
      userType: session ? 'authenticated' : 'guest',
      plan: 'free',
      secondsRemaining: dailySecondsRemaining ?? undefined,
      conversationId: conversationId || undefined,
      source: 'paywall_button',
    };
    trackUpgradeClick(properties);
    startCheckout();
  };

  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 z-50 grid place-items-center bg-black/60 backdrop-blur-sm p-4">
      <div
        className="w-full max-w-md rounded-2xl border border-white/10 bg-[#12101b] shadow-2xl p-6 text-center"
        role="dialog"
        aria-modal="true"
        aria-label="Paywall"
      >
        {/* Dynamic header messaging based on paywallSource */}
        {paywallSource === 'time_exhausted' && (
          <>
            <h2 className="text-2xl font-semibold">You reached today’s free limit</h2>
            <p className="text-sm text-white/70 my-3">Go unlimited to continue the conversation.</p>
          </>
        )}
        {paywallSource === 'proactive_click' && (
          <>
            <h2 className="text-2xl font-semibold">Go Unlimited with Kira Pro</h2>
            <p className="text-sm text-white/70 my-3">
              Unlock unlimited conversations and support Kira's development.
            </p>
          </>
        )}

        <div className="mb-6 p-4 rounded-lg bg-white/5 border border-white/10 text-left">
          <ul className="text-sm text-white/80 space-y-1 list-disc pl-5">
            <li>
              <strong>Unlimited Conversations:</strong> Chat with Kira as long as you want, every
              single day, without interruption.
            </li>
            <li>
              <strong>Early Access to New Features:</strong> Be the first to try out new
              capabilities, voices, and personalities as we build them.
            </li>
            <li>
              <strong>Support Kira's Development:</strong> Your subscription directly helps us
              improve the experience and keep the conversation going.
            </li>
          </ul>
        </div>

        {/* Dynamic note under features */}
        {paywallSource === 'time_exhausted' ? (
          <div className="mb-4 p-3 bg-rose-900/20 border border-rose-700/30 rounded-lg">
            <p className="text-sm text-rose-200 text-center">
              You've used all your {totalMinutes ?? Math.floor((dailyLimitSeconds || 0) / 60)} free
              minutes for today
            </p>
          </div>
        ) : (
          <div className="mb-4 p-3 bg-fuchsia-900/20 border border-fuchsia-700/30 rounded-lg">
            <p className="text-sm text-fuchsia-200 text-center">
              You have {Math.ceil((dailySecondsRemaining ?? 0) / 60)} minutes remaining today.
            </p>
          </div>
        )}

        <div className="space-y-3">
          {signedIn ? (
            <button
              onClick={() => {
                setIsLoadingCheckout(true);
                handleUpgradeClick();
              }}
              className="w-full rounded-lg bg-fuchsia-600 text-white font-medium py-3 hover:bg-fuchsia-700 disabled:opacity-50"
              disabled={isLoadingCheckout}
            >
              {isLoadingCheckout ? 'Opening Checkout…' : `Upgrade • ${price}`}
            </button>
          ) : (
            <>
              <Link
                href={signUpHref}
                onClick={() => {
                  setIsLoadingCheckout(true);
                  handleUpgradeClick();
                }}
                className="block w-full rounded-lg bg-fuchsia-600 text-white font-medium py-3 hover:bg-fuchsia-700"
              >
                Upgrade • {price}
              </Link>
              <Link
                href={signInHref}
                onClick={handleUpgradeClick}
                className="block w-full rounded-lg border border-white/15 text-white font-medium py-3 hover:bg-white/5"
              >
                Log in to continue
              </Link>
            </>
          )}
          <button
            onClick={() => {
              const properties: PaywallEventProperties = {
                userId: session?.user?.id,
                userType: session ? 'authenticated' : 'guest',
                plan: isPro ? 'pro' : 'free',
                secondsRemaining: dailySecondsRemaining ?? undefined,
                conversationId: conversationId || undefined,
                source: paywallSource || undefined,
              };
              trackPaywallDismissed(properties);
              closePaywall();
            }}
            className="text-sm text-white/60 hover:underline"
          >
            {paywallSource === 'time_exhausted' ? 'Come back tomorrow' : 'Maybe later'}
          </button>
        </div>
        {Number.isFinite(dailySecondsRemaining) && (dailySecondsRemaining ?? 0) > 0 && (
          <div className="mt-4 text-xs text-white/40">
            {Math.floor((dailySecondsRemaining ?? 0) / 60)} minutes remaining today
          </div>
        )}
      </div>
    </div>
  );
}
