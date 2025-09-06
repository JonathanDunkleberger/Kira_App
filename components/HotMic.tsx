'use client';
import PulsingOrb from '@/components/PulsingOrb';
import { useConversation } from '@/lib/state/ConversationProvider';
import MicButton from './MicButton';

export default function HotMic() {
  const { turnStatus, startConversation, stopConversation } = useConversation();

  const isListening = turnStatus === 'listening';
  const isProcessing = turnStatus === 'processing';
  const isSpeaking = turnStatus === 'speaking';

  // This function tells the app what to do when the orb is clicked
  const handleMicClick = async () => {
    if (isListening || isProcessing || isSpeaking) {
      stopConversation();
    } else {
      await Promise.resolve(startConversation());
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