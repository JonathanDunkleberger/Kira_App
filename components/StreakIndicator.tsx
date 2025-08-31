"use client";
import { useEffect } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { useConversation } from '@/lib/state/ConversationProvider';

export default function StreakIndicator() {
  const { currentStreak } = useConversation();

  if (!currentStreak || currentStreak <= 0) return null;

  return (
    <div className="fixed top-16 right-3 z-40 select-none">
      <AnimatePresence mode="popLayout">
        <motion.div
          key={currentStreak}
          initial={{ scale: 0.9, opacity: 0 }}
          animate={{ scale: 1, opacity: 1 }}
          exit={{ scale: 0.9, opacity: 0 }}
          transition={{ type: 'spring', stiffness: 500, damping: 30 }}
          className="rounded-full bg-amber-500/20 border border-amber-400/30 px-3 py-1 text-amber-200 text-sm shadow-lg"
          aria-label={`Current streak: ${currentStreak}`}
        >
          <span className="mr-1">🔥</span>
          {currentStreak}
        </motion.div>
      </AnimatePresence>
    </div>
  );
}
