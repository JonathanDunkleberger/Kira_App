'use client';
import { useConversationStore } from '@/lib/state/conversation-store';
import { useEffect } from 'react';
import { connectVoice, startMic } from '@/lib/voice';

export default function SimpleConversation() {
  const { status, messages, setStatus } = useConversationStore();
  useEffect(() => {
    // Auto connect & start mic for simple demo
    connectVoice({ persona: 'kira' }).then(() => {
      startMic().catch(() => {});
    }).catch(() => {});
  }, []);

  const handleMicClick = () => {
    setStatus(status === 'listening' ? 'idle' : 'listening');
  };

  return (
    <div className="flex flex-col items-center gap-4 p-6">
      <div className="messages w-full max-w-2xl space-y-2">
        {messages.map((msg: { role: 'user' | 'assistant'; content: string }, index: number) => (
          <div
            key={index}
            className={`p-2 rounded ${msg.role === 'assistant' ? 'bg-purple-900/40' : 'bg-gray-800/40'}`}
          >
            <span className="font-bold mr-2">{msg.role === 'assistant' ? 'Kira' : 'You'}:</span>
            {msg.content}
          </div>
        ))}
        {messages.length === 0 && (
          <div className="text-gray-400 text-center">Listening... Say something!</div>
        )}
      </div>

      <button
        onClick={handleMicClick}
        className={`px-6 py-3 rounded-full text-white font-semibold ${status === 'listening' ? 'bg-rose-600' : 'bg-fuchsia-700'}`}
      >
        {status === 'listening' ? 'Stop' : 'Start'} Listening
      </button>

      <div className="text-sm text-gray-400">Status: {status}</div>
    </div>
  );
}
