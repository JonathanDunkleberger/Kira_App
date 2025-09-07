'use client';
import { useEffect } from 'react';
import { AnimatePresence, motion } from 'framer-motion';
import { useConversation } from '@/lib/state/ConversationProvider';

export default function AchievementToast() {
  const { newlyUnlockedToast, setNewlyUnlockedToast } = useConversation();

  useEffect(() => {
    if (!newlyUnlockedToast) return;
    const id = window.setTimeout(() => setNewlyUnlockedToast?.(null), 4000);
    return () => window.clearTimeout(id);
  }, [newlyUnlockedToast, setNewlyUnlockedToast]);

  return (
    <div className="pointer-events-none fixed inset-x-0 bottom-6 z-50 flex justify-center">
      <AnimatePresence>
        {newlyUnlockedToast && (
          <motion.div
            initial={{ y: 20, opacity: 0 }}
            animate={{ y: 0, opacity: 1 }}
            exit={{ y: 20, opacity: 0 }}
            transition={{ type: 'spring', stiffness: 400, damping: 28 }}
            className="pointer-events-auto rounded-full bg-black/80 backdrop-blur border border-white/10 px-4 py-2 text-white/90 text-sm shadow-lg flex items-center gap-2"
            role="status"
          >
            <span className="text-base">🏆</span>
            <div>
              <div className="font-medium leading-tight">{newlyUnlockedToast.name}</div>
              {newlyUnlockedToast.description ? (
                <div className="text-white/70 text-xs leading-tight">
                  {newlyUnlockedToast.description}
                </div>
              ) : null}
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}
