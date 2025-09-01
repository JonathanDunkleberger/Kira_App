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
  isPro,
  dailySecondsRemaining,
  promptPaywall,
  } = useConversation();

  const isSessionActive = conversationStatus === 'active';
  const handleClick = () => {
    // Definitive paywall gate: click opens paywall when out of time
    if (!isPro && (dailySecondsRemaining ?? 0) <= 0) {
      promptPaywall();
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
      // expand/contract with live mic volume
      return baseScale + Math.min(0.4, Math.max(0, micVolume)) * 0.4 + 0; // cap subtlely
    }
    if (turnStatus === 'assistant_speaking') {
      return baseScale; // use keyframe animate below for gentle pulse
    }
    return baseScale;
  })();
  const pulseWhenAssistant = turnStatus === 'assistant_speaking'
    ? { scale: [1, 1.05, 1], transition: { duration: 1.5, repeat: Infinity } as const }
    : undefined;
  // --- END ANIMATION LOGIC ---

  return (
  <div className="flex flex-col items-center gap-4">
        <motion.button
          onClick={handleClick}
          className="relative inline-flex items-center justify-center h-40 w-40 rounded-full text-white text-lg font-semibold text-center leading-snug select-none"
          // Animate orb scale and glow
          animate={pulseWhenAssistant ?? { scale }}
          transition={{ type: 'spring', stiffness: 300, damping: 20 }}
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