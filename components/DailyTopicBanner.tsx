"use client";
import { useState } from 'react';
import { useConversation } from '@/lib/state/ConversationProvider';
import { motion, AnimatePresence } from 'framer-motion';

export default function DailyTopicBanner() {
  const { dailyTopic } = useConversation();
  const [dismissed, setDismissed] = useState(false);
  const [copied, setCopied] = useState(false);
  if (!dailyTopic || dismissed) return null;
  return (
    <div className="fixed top-16 left-1/2 -translate-x-1/2 z-40">
      <AnimatePresence>
        <motion.div
          initial={{ y: -10, opacity: 0 }}
          animate={{ y: 0, opacity: 1 }}
          exit={{ y: -10, opacity: 0 }}
          transition={{ type: 'spring', stiffness: 400, damping: 28 }}
          className="rounded-xl bg-white/10 border border-white/15 px-4 py-2 text-white/90 text-sm backdrop-blur"
          role="note"
        >
          <div className="flex items-center gap-3">
            <span className="opacity-80">🎯</span>
            <button
              className="text-left hover:underline"
              onClick={async () => {
                try {
                  await navigator.clipboard.writeText(dailyTopic);
                  setCopied(true);
                  setTimeout(() => setCopied(false), 1500);
                } catch {}
              }}
            >
              {dailyTopic}
            </button>
            <button className="ml-2 text-white/60 hover:text-white" onClick={() => setDismissed(true)} aria-label="Dismiss daily topic">✕</button>
          </div>
          {copied && <div className="text-xs text-emerald-300 mt-1">Copied to clipboard</div>}
        </motion.div>
      </AnimatePresence>
    </div>
  );
}
