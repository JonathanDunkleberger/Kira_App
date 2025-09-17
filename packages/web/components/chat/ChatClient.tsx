'use client';
import { useEffect, useState } from 'react';
import { useKiraSocket } from '../../lib/hooks/useKiraSocket';
import { useConversationStore } from '../../lib/state/conversation-store';

const CallControls = ({ isMuted, onMuteToggle }: { isMuted: boolean; onMuteToggle: () => void }) => (
  <div className="flex gap-4">
    <button onClick={onMuteToggle} className="px-4 py-2 bg-gray-700 rounded">
      {isMuted ? 'Unmute' : 'Mute'}
    </button>
    <button onClick={() => window.location.assign('/')} className="px-4 py-2 bg-red-700 rounded">
      End Call
    </button>
  </div>
);

const VoiceOrb = ({ isSpeaking }: { isSpeaking: boolean }) => (
  <div
    className={`w-72 h-72 rounded-full transition-all ${
      isSpeaking ? 'bg-purple-500 animate-pulse' : 'bg-purple-800'
    }`}
  ></div>
);

const AnimatedTranscript = ({
  messages,
}: {
  messages: { role: string; content: string }[];
}) => (
  <div className="text-white text-center h-full overflow-y-auto">
    {messages.map((msg, i) => (
      <p key={i}>
        <strong>{msg.role}:</strong> {msg.content}
      </p>
    ))}
  </div>
);

export default function ChatClient({ conversationId }: { conversationId: string }) {
  const { status, startMic, stopMic } = useKiraSocket(conversationId);
  const { messages, isSpeaking } = useConversationStore();
  const [isMuted, setIsMuted] = useState(false);

  useEffect(() => {
    if (status === 'connected' && !isMuted) {
      startMic();
    } else {
      stopMic();
    }
  }, [status, isMuted, startMic, stopMic]);

  const handleMuteToggle = () => setIsMuted((p) => !p);

  return (
    <div className="flex flex-col items-center justify-center h-full w-full">
      <audio id="tts-audio" className="hidden" />
      <div className="mt-10" />
      <VoiceOrb isSpeaking={isSpeaking} />
      <div className="mt-10" />
      <div className="w-full max-w-2xl h-24">
        <AnimatedTranscript messages={messages} />
      </div>
      <div className="fixed left-1/2 bottom-6 -translate-x-1/2">
        <CallControls isMuted={isMuted} onMuteToggle={handleMuteToggle} />
      </div>
    </div>
  );
}
