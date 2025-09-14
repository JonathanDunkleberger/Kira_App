'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { motion, AnimatePresence, useReducedMotion } from 'framer-motion';

import { startCheckout } from '@/lib/client-api';
import { trackPaywallEvent, trackUpgradeNudged, trackUpgradeNudgeClick } from '@/lib/analytics';

type Props = {
  open: boolean;
  onClose: () => void;
  secondsRemaining?: number | null;
  conversationId?: string | null;
  anchorTop?: boolean; // optional: flip position if transcript modal is open
  userType?: 'guest' | 'authenticated';
  plan?: 'free' | 'pro';
  source?: 'last_turn' | 'proactive_threshold';
};

const TODAY_KEY = () => `kira_nudge_suppressed_${new Date().toISOString().slice(0, 10)}`;

export default function UpgradeSnackbar({
  open,
  onClose,
  secondsRemaining,
  conversationId,
  anchorTop = false,
  userType = 'guest',
  plan = 'free',
  source = 'last_turn',
}: Props) {
  const prefersReduced = useReducedMotion();
  const [visible, setVisible] = useState(false);
  const [hover, setHover] = useState(false);
  const timerRef = useRef<number | null>(null);

  const suppressedToday = useMemo(() => {
    try {
      return sessionStorage.getItem(TODAY_KEY()) === '1';
    } catch {
      return false;
    }
  }, []);

  const dismiss = useCallback(
    (reason: 'timeout' | 'click') => {
      try {
        sessionStorage.setItem(TODAY_KEY(), '1');
      } catch {}
      setVisible(false);
      onClose?.();
      if (reason === 'click') {
        trackPaywallEvent('upgrade_nudge_dismiss', {
          userType,
          plan,
          secondsRemaining: secondsRemaining ?? undefined,
          conversationId: conversationId ?? undefined,
          source,
        });
      }
    },
    [onClose, userType, plan, secondsRemaining, conversationId, source],
  );

  // show/hide with per-day suppression
  useEffect(() => {
    if (open && !suppressedToday) {
      setVisible(true);
      trackUpgradeNudged({
        userType,
        plan,
        secondsRemaining: secondsRemaining ?? undefined,
        conversationId: conversationId ?? undefined,
        source,
      });
    } else {
      setVisible(false);
    }
  }, [open, suppressedToday, secondsRemaining, conversationId, userType, plan, source]);

  // 8s auto-dismiss, paused on hover
  useEffect(() => {
    if (!visible) return;
    if (hover) {
      if (timerRef.current) window.clearTimeout(timerRef.current);
      return;
    }
    timerRef.current = window.setTimeout(() => {
      dismiss('timeout');
    }, 8000) as unknown as number;
    return () => {
      if (timerRef.current) window.clearTimeout(timerRef.current);
    };
  }, [visible, hover, dismiss]);

  const handleUpgrade = () => {
    trackUpgradeNudgeClick({
      userType,
      plan,
      secondsRemaining: secondsRemaining ?? undefined,
      conversationId: conversationId ?? undefined,
      source,
    });
    startCheckout();
  };

  const variants = prefersReduced
    ? { hidden: { opacity: 0 }, show: { opacity: 1 }, exit: { opacity: 0 } }
    : {
        hidden: { opacity: 0, y: anchorTop ? -16 : 16, scale: 0.98 },
        show: {
          opacity: 1,
          y: 0,
          scale: 1,
          transition: { type: 'spring', stiffness: 420, damping: 28 },
        },
        exit: { opacity: 0, y: anchorTop ? -16 : 16, scale: 0.98, transition: { duration: 0.18 } },
      };

  const mm = Math.max(0, Math.floor((secondsRemaining ?? 0) / 60));
  const ss = Math.max(0, (secondsRemaining ?? 0) % 60);
  const countdown = secondsRemaining != null ? `${mm}:${String(ss).padStart(2, '0')}` : null;

  return (
    <div
      aria-live="polite"
      aria-atomic="true"
      className="pointer-events-none fixed z-[60] inset-0 flex"
      style={{ justifyContent: 'flex-end', alignItems: anchorTop ? 'flex-start' : 'flex-end' }}
    >
      <AnimatePresence>
        {visible && (
          <motion.div
            role="status"
            initial="hidden"
            animate="show"
            exit="exit"
            variants={variants}
            onMouseEnter={() => setHover(true)}
            onMouseLeave={() => setHover(false)}
            className="pointer-events-auto m-4 max-w-sm rounded-2xl border border-white/10 bg-[#12101b]/95 shadow-2xl backdrop-blur p-4"
          >
            <div className="flex items-start gap-3">
              <div className="h-9 w-9 rounded-full bg-gradient-to-br from-fuchsia-500 to-purple-700 shadow-md grid place-items-center">
                <span className="text-sm font-bold">✨</span>
              </div>
              <div className="flex-1">
                <div className="text-sm font-semibold">One more thing…</div>
                <div className="text-sm text-white/70 mt-0.5">
                  That was your last free reply today. Unlock unlimited Kira for{' '}
                  <span className="font-medium">$1.99/mo</span>.
                  {countdown ? (
                    <span className="ml-1 text-white/50">({countdown} left today)</span>
                  ) : null}
                </div>
                <div className="mt-3 flex gap-2">
                  <button
                    onClick={handleUpgrade}
                    aria-label="Upgrade and continue"
                    className="inline-flex items-center justify-center rounded-lg bg-fuchsia-600 hover:bg-fuchsia-700 px-3 py-1.5 text-sm font-medium"
                  >
                    Upgrade & Continue
                  </button>
                  <button
                    onClick={() => dismiss('click')}
                    aria-label="Dismiss"
                    className="rounded-lg border border-white/15 px-3 py-1.5 text-sm text-white/80 hover:bg-white/5"
                  >
                    Not now
                  </button>
                </div>
              </div>
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}
