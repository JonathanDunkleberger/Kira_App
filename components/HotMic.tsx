'use client';
import PulsingOrb from '@/components/PulsingOrb';
import { useConversation } from '@/lib/state/ConversationProvider';
import MicButton from './MicButton';

export default function HotMic() {
  const { uiState, startConversation, stopConversation } = useConversation();

  const isListening = uiState === 'LISTENING';
  const isProcessing = uiState === 'PROCESSING';
  const isSpeaking = uiState === 'SPEAKING';

  const handleMicClick = async () => {
    switch (uiState) {
      case 'IDLE':
        await Promise.resolve(startConversation());
        break;
      case 'LISTENING':
      case 'PROCESSING':
      case 'SPEAKING':
        stopConversation();
        break;
    }
  };

  if (isListening || isProcessing || isSpeaking) {
    return (
      <div
        onClick={handleMicClick} // <-- This onClick was missing
        className="cursor-pointer relative w-48 h-48 flex items-center justify-center"
        aria-label="Stop conversation"
      >
        <PulsingOrb
          isProcessing={isProcessing}
          isSpeaking={isSpeaking}
        />
        <span className="absolute text-white font-medium text-lg capitalize">
          {isProcessing ? 'Processing...' : isSpeaking ? 'Speaking...' : 'Listening...'}
        </span>
      </div>
    );
  }

  // This renders the idle button, which also needs the onClick handler
  return (
    <div onClick={handleMicClick} aria-label="Start conversation">
      <MicButton />
    </div>
  );
}