"use client";
import { useEffect } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { useConversation } from '@/lib/state/ConversationProvider';

export default function StreakIndicator() {
  const { currentStreak } = useConversation();
  if (!currentStreak || currentStreak <= 0) return null;
  return (
    <AnimatePresence mode="popLayout">
      <motion.div
        key={currentStreak}
        initial={{ scale: 0.95, opacity: 0 }}
        animate={{ scale: 1, opacity: 1 }}
        exit={{ scale: 0.95, opacity: 0 }}
        transition={{ type: 'spring', stiffness: 500, damping: 30 }}
        className="inline-flex items-center gap-1 rounded-full border border-white/10 bg-white/5 px-2.5 py-1 text-xs text-white/80"
        aria-label={`Current streak: ${currentStreak}`}
        title={`Daily streak: ${currentStreak}`}
      >
        <span>🔥</span>
        <motion.span
          key={`n-${currentStreak}`}
          initial={{ opacity: 0, y: -5 }}
          animate={{ opacity: 1, y: 0 }}
          exit={{ opacity: 0, y: 5 }}
          transition={{ duration: 0.2 }}
          className="tabular-nums"
        >
          {currentStreak}
        </motion.span>
      </motion.div>
    </AnimatePresence>
  );
}
