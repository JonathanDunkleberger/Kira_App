"use client";

import { useConversation } from '@/lib/state/ConversationProvider';
import { useMemo } from 'react';

export default function HotMic() {
  const { 
    conversationStatus, 
    turnStatus, 
    startConversation, 
    stopConversation,
  micVolume
  } = useConversation();

  const isSessionActive = conversationStatus === 'active';

  const handleClick = () => {
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
  
  return (
    <div className="flex flex-col items-center gap-4">
      <button
        onClick={handleClick}
        className="relative inline-flex items-center justify-center h-40 w-40 rounded-full transition-all duration-100 ease-out text-white text-lg font-semibold text-center leading-snug select-none"
        style={{
          boxShadow: isSessionActive
            ? (turnStatus === 'processing_speech'
                ? '0 0 60px #fbbf24, 0 0 25px #fbbf24 inset'
                : '0 0 50px #a855f7, 0 0 20px #a855f7 inset')
            : '0 0 24px #4c1d95',
          background: isSessionActive
            ? (turnStatus === 'processing_speech'
                ? 'radial-gradient(circle, #fcd34d, #b45309)'
                : 'radial-gradient(circle, #d8b4fe, #7e22ce)')
            : 'radial-gradient(circle, #6d28d9, #1e1b4b)',
          transform: `scale(${turnStatus === 'user_listening' ? 1 + micVolume * 2 : (isSessionActive ? 1.05 : 1)})`,
        }}
      >
        {orbText}
      </button>
      <div className="h-8 text-center">
        <p className="text-gray-400">{subText}</p>
      </div>
    </div>
  );
}