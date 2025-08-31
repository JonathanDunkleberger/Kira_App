"use client";
import { useMemo, useState } from "react";
import { useConversation } from "@/lib/state/ConversationProvider";
import { motion, AnimatePresence, useReducedMotion } from "framer-motion";
import { trackUpgradeNudgeClick } from "@/lib/analytics";

export default function HeaderUsageChip() {
  const { isPro, dailySecondsRemaining, promptPaywall, conversationId } = useConversation();
  const r = dailySecondsRemaining ?? 0;
  const prefersReduced = useReducedMotion();
  const [open, setOpen] = useState(false);

  const mm = Math.max(0, Math.floor(r / 60));
  const ss = Math.max(0, r % 60);
  const time = `${mm}:${String(ss).padStart(2, "0")}`;

  const state = useMemo<"idle" | "warn" | "urgent">(() => {
    if (isPro) return "idle";
    if (r <= 30) return "urgent";
    if (r <= 120) return "warn";
    return "idle";
  }, [r, isPro]);

  const aura =
    state === "urgent"
      ? "shadow-[0_0_24px_rgba(236,72,153,0.55)]"
      : state === "warn"
      ? "shadow-[0_0_16px_rgba(168,85,247,0.35)]"
      : "shadow-none";

  const pulse =
    prefersReduced
      ? ""
      : state === "urgent"
      ? "animate-pulse"
      : state === "warn"
      ? "motion-safe:animate-[pulse_2s_ease-in-out_infinite]"
      : "";

  const handleUpgradeClick = () => {
    trackUpgradeNudgeClick({
      userType: isPro ? 'authenticated' : 'guest',
      plan: isPro ? 'pro' : 'free',
      secondsRemaining: r,
      conversationId: conversationId || undefined,
      source: 'chip_popover'
    });
    promptPaywall();
  };

  return (
    <div className="relative">
      <button
        onClick={() => !isPro && setOpen((v) => !v)}
        className={`flex items-center gap-2 rounded-full border border-white/10 bg-white/5 px-3 py-1.5 text-sm ${aura}`}
        aria-expanded={open}
        aria-haspopup="dialog"
      >
        {isPro ? (
          <>
            <span className="h-2 w-2 rounded-full bg-emerald-400" />
            <span className="font-medium">Pro</span>
            <span className="text-white/60">Unlimited</span>
          </>
        ) : (
          <>
            <span
              className={`h-2 w-2 rounded-full ${
                state === "urgent"
                  ? "bg-rose-400"
                  : state === "warn"
                  ? "bg-fuchsia-400"
                  : "bg-white/60"
              } ${pulse}`}
            />
            <span className="font-medium">Free today:</span>
            <span className="tabular-nums">{time}</span>
          </>
        )}
      </button>

      <AnimatePresence>
        {!isPro && open && (
          <motion.div
            initial={{ opacity: 0, y: 6, scale: 0.98 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: 6, scale: 0.98 }}
            transition={{ type: "spring", stiffness: 420, damping: 30 }}
            className="absolute right-0 mt-2 w-72 rounded-2xl border border-white/10 bg-[#12101b]/95 p-3 shadow-2xl backdrop-blur"
            role="dialog"
            aria-label="Upgrade"
          >
            <div className="text-sm">
              <div className="font-semibold">Go unlimited</div>
              <div className="text-white/70 mt-1">
                Unlimited daily minutes, faster responses, priority voice.
              </div>
            </div>
            <div className="mt-3 flex gap-2">
              <button
                onClick={handleUpgradeClick}
                className="rounded-lg bg-fuchsia-600 hover:bg-fuchsia-700 px-3 py-1.5 text-sm font-medium"
              >
                Upgrade • $1.99/mo
              </button>
              <button
                onClick={() => setOpen(false)}
                className="rounded-lg border border-white/15 px-3 py-1.5 text-sm text-white/80 hover:bg-white/5"
              >
                Not now
              </button>
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}
