// FILE: packages/web/components/chat/ChatClient.tsx
'use client';
import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { useKiraSocket } from '../../lib/hooks/useKiraSocket';
import { useConversationStore } from '../../lib/state/conversation-store';
import VoiceOrb from '../VoiceOrb';

const AnimatedTranscript = ({ messages }: { messages: { role: string; content: string }[] }) => {
  const lastMessage = messages[messages.length - 1];
  return (
    <div className="text-neutral-800 dark:text-white text-center h-full overflow-y-auto text-lg leading-relaxed">
      {lastMessage && (
        <p>
          <strong className="text-neutral-500 dark:text-white/60">{lastMessage.role === 'user' ? 'You' : 'Kira'}:</strong>{' '}
          {lastMessage.content}
          {useConversationStore.getState().isSpeaking && <span className="animate-pulse">▍</span>}
        </p>
      )}
    </div>
  );
};

const CallControls = ({ onEndCall }: { onEndCall: () => void }) => (
  <div className="flex gap-4">
    <button
      onClick={onEndCall}
      className="px-6 py-3 bg-red-600 hover:bg-red-700 rounded-full text-white font-semibold"
    >
      End Call
    </button>
  </div>
);

export default function ChatClient({ conversationId }: { conversationId: string }) {
  const { status, startMic, stopMic } = useKiraSocket(conversationId);
  const { messages, isSpeaking, clearMessages } = useConversationStore();
  const router = useRouter();

  useEffect(() => {
    clearMessages();
  }, [clearMessages]);

  useEffect(() => {
    if (status === 'connected') {
      startMic();
      const audioEl = document.getElementById('tts-audio') as HTMLAudioElement;
      if (audioEl) {
        audioEl.muted = false;
        audioEl.play?.().catch(() => {});
      }
    }
    return () => stopMic();
  }, [status, startMic, stopMic]);

  const handleEndCall = () => {
    stopMic();
    router.push('/');
  };

  return (
    <div className="flex flex-col items-center justify-center h-full w-full">
      <audio id="tts-audio" className="hidden" autoPlay muted />
      <div className="absolute top-1/4 w-full max-w-3xl px-4">
        <AnimatedTranscript messages={messages} />
      </div>
      <VoiceOrb size={280} />
      <div className="fixed left-1/2 bottom-10 -translate-x-1/2">
        <CallControls onEndCall={handleEndCall} />
      </div>
    </div>
  );
}
