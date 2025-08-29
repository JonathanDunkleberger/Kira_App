"use client";

import { useEffect, useRef } from 'react';
import { useConversation } from '@/lib/state/ConversationProvider';

export default function ConversationView() {
  const { messages, error } = useConversation();
  const endRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    endRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages.length]);

  return (
    <div className="w-full max-w-xl text-left">
      <div className="space-y-3">
        {messages.map(m => (
          <div key={m.id} className={m.role === 'user' ? 'text-gray-200' : 'text-fuchsia-200'}>
            <div className={
              `inline-block px-3 py-2 rounded-lg ${m.role === 'user' ? 'bg-white/5' : 'bg-fuchsia-900/30'}`
            }>
              {m.role === 'user' ? 'You: ' : 'Kira: '}{m.content}
            </div>
          </div>
        ))}
        {error && (
          <div className="text-red-400 text-sm">{error}</div>
        )}
        <div ref={endRef} />
      </div>
    </div>
  );
}
