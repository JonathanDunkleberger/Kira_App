"use client";

import { useConversation } from '@/lib/state/ConversationProvider';
import { useMemo } from 'react';
import { motion } from 'framer-motion';

export default function HotMic() {
  const { 
    conversationStatus, 
    turnStatus, 
    startConversation, 
    stopConversation,
  micVolume,
  kiraVolume,
  isPro,
  dailySecondsRemaining,
  promptPaywall,
  } = useConversation();

  const isSessionActive = conversationStatus === 'active';
  const handleClick = () => {
    // Always produce a visible result on click
    const remaining = dailySecondsRemaining ?? 0;
    if (!isPro && remaining <= 0) {
      promptPaywall('proactive_click');
      return;
    }
    if (isSessionActive) {
      stopConversation();
    } else {
      startConversation();
    }
  };

  const { orbText, subText } = useMemo(() => {
    if (!isSessionActive) {
      return { orbText: 'Start Conversation', subText: 'Click to begin' };
    }
    switch (turnStatus) {
      case 'user_listening':
        return { orbText: 'Listening...', subText: 'Just start talking' };
      case 'processing_speech':
        return { orbText: 'Processing...', subText: 'Kira is thinking' };
      case 'assistant_speaking':
        return { orbText: 'Speaking...', subText: 'Kira is responding' };
      default:
        return { orbText: 'Click to End', subText: '' };
    }
  }, [isSessionActive, turnStatus]);

  // --- START ANIMATION LOGIC ---
  const baseScale = 1;
  const scale = (() => {
    if (turnStatus === 'user_listening') {
      // A more sensitive curve: low volume has little effect, high volume has a big effect.
      return baseScale + Math.pow(micVolume, 2) * 0.7;
    }
    if (turnStatus === 'assistant_speaking') {
      // Drive the scale with Kira's real-time audio volume
      return baseScale + Math.pow(kiraVolume || 0, 2) * 0.5;
    }
    return baseScale;
  })();
  // --- END ANIMATION LOGIC ---

  return (
  <div className="flex flex-col items-center gap-4">
        <motion.button
          onClick={handleClick}
          className="relative inline-flex items-center justify-center h-40 w-40 rounded-full text-white text-lg font-semibold text-center leading-snug select-none"
          // Animate orb scale and glow directly
          animate={{ scale }}
          transition={{ type: 'spring', stiffness: 300, damping: 20 }}
          aria-disabled={false}
          style={{
            background: turnStatus === 'processing_speech'
              ? 'radial-gradient(circle, #fcd34d, #b45309)'
              : 'radial-gradient(circle, #d8b4fe, #7e22ce)',
            boxShadow: (turnStatus === 'user_listening' || turnStatus === 'assistant_speaking')
              ? '0 0 70px #a855f7, 0 0 30px #a855f7 inset'
              : '0 0 50px #a855f7, 0 0 20px #a855f7 inset',
          }}
        >
          {orbText}
        </motion.button>
      
      <div className="h-8 text-center">
        <p className="text-gray-400">{subText}</p>
      </div>
    </div>
  );
}