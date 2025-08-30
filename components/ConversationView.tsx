"use client";

import { useEffect, useRef } from 'react';
import { useConversation } from '@/lib/state/ConversationProvider';

export default function ConversationView() {
  const { messages, error, conversationStatus } = useConversation();
  const scrollRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (scrollRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
    }
  }, [messages]);

  if (conversationStatus === 'idle') {
    return (
      <div className="text-center text-gray-500 pt-10">
        Click the orb to start a conversation with Kira.
      </div>
    );
  }

  return (
    <div ref={scrollRef} className="w-full max-w-4xl mx-auto p-4 h-[40vh] overflow-y-auto flex flex-col-reverse">
      <div className="space-y-3">
        {messages.slice().reverse().map(m => (
          <div key={m.id} className={m.role === 'user' ? 'text-gray-200' : 'text-fuchsia-200'}>
            <div className={`inline-block px-3 py-2 rounded-lg ${m.role === 'user' ? 'bg-white/5' : 'bg-fuchsia-900/30'}`}>
              {m.role === 'user' ? 'You: ' : 'Kira: '}{m.content}
            </div>
          </div>
        ))}
        {messages.length === 0 && conversationStatus === 'active' && (
          <div className="text-center text-gray-400">Listening... Say something!</div>
        )}
        {error && <div className="text-red-400 text-sm">{error}</div>}
      </div>
    </div>
  );
}
