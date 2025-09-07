'use client';
import PulsingOrb from '@/components/PulsingOrb';
import { useConversation } from '@/lib/state/ConversationProvider';
import MicButton from './MicButton';

export default function HotMic() {
  const { turnStatus, isConversationActive, startConversation, stopConversation } = useConversation();

  const isListening = turnStatus === 'listening';
  const isProcessing = turnStatus === 'processing';
  const isSpeaking = turnStatus === 'speaking';

  const handleMicClick = async () => {
    if (isConversationActive) {
      stopConversation();
    } else {
      await Promise.resolve(startConversation());
    }
  };

  // Decide whether to render the orb or the start button
  const showOrb = isConversationActive || isListening || isProcessing || isSpeaking;

  // Determine dynamic text for the orb. In an active conversation, IDLE shows no text.
  let orbText = '';
  if (!isConversationActive) {
    orbText = 'Start Conversation';
  } else if (isListening) {
    orbText = 'Listening...';
  } else if (isProcessing) {
    orbText = 'Processing...';
  } else if (isSpeaking) {
    orbText = 'Speaking...';
  }

  if (showOrb) {
    return (
      <div
        onClick={handleMicClick}
        className="cursor-pointer relative w-48 h-48 flex items-center justify-center"
        aria-label={isConversationActive ? 'Stop conversation' : 'Start conversation'}
      >
        <PulsingOrb isProcessing={isProcessing} isSpeaking={isSpeaking} />
        {orbText && (
          <span className="absolute text-white font-medium text-lg capitalize">
            {orbText}
          </span>
        )}
      </div>
    );
  }

  // Not active and idle: render the start button
  return (
    <div onClick={handleMicClick} aria-label="Start conversation">
      <MicButton />
    </div>
  );
}