'use client';

import { useEffect, useRef, useState } from 'react';
import { User, Bot } from 'lucide-react';

import { usePartialStore } from '../lib/partialStore';
import { useAssistantStream } from '../lib/assistantStreamStore';
import { useConversation } from '../lib/state/ConversationProvider';

export default function ConversationView() {
  const { messages, error, conversationStatus } = useConversation();
  const partial = usePartialStore((s) => s.partial);
  const { text: assistantStreamText, streaming: assistantStreaming } = useAssistantStream();
  const scrollRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (scrollRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
    }
  }, [messages]);

  if (conversationStatus === 'idle') {
    return <div className="text-center text-gray-500 pt-10"></div>;
  }

  return (
    <div
      ref={scrollRef}
      className="w-full max-w-4xl mx-auto p-4 h-[calc(100vh-350px)] overflow-y-auto custom-scrollbar"
    >
      <div className="space-y-3">
        {messages.map(
          (m: { id: string; role: 'user' | 'assistant'; content: string }, idx: number) => {
            const isAssistant = m.role === 'assistant';
            const prevUser = idx > 0 ? messages[idx - 1] : null;
            // Share feature removed
            return (
              <div key={m.id} className="flex items-start gap-4">
                {/* AVATAR */}
                <div
                  className={`flex-shrink-0 w-8 h-8 rounded-full grid place-items-center ${isAssistant ? 'bg-fuchsia-800/50' : 'bg-gray-700/50'}`}
                >
                  {isAssistant ? (
                    <Bot size={18} className="text-fuchsia-300" />
                  ) : (
                    <User size={18} className="text-gray-300" />
                  )}
                </div>

                {/* MESSAGE CONTENT */}
                <div className="flex-grow pt-1">
                  <div className="font-bold text-sm mb-1">{isAssistant ? 'Kira' : 'You'}</div>
                  <p className="text-white/90 leading-relaxed">{m.content}</p>
                </div>
              </div>
            );
          },
        )}
        {messages.length === 0 && conversationStatus === 'active' && (
          <div className="text-center text-gray-400">Listening... Say something!</div>
        )}
        {!!assistantStreamText && assistantStreaming && (
          <div className="mt-4 flex items-start gap-4">
            <div className="flex-shrink-0 w-8 h-8 rounded-full grid place-items-center bg-fuchsia-800/50">
              <Bot size={18} className="text-fuchsia-300" />
            </div>
            <div className="flex-grow pt-1">
              <div className="font-bold text-sm mb-1">Kira</div>
              <p className="text-white/90 leading-relaxed">
                {assistantStreamText}
                <span className="animate-pulse ml-1">▍</span>
              </p>
            </div>
          </div>
        )}
        {!!partial && !assistantStreaming && (
          <div className="mt-4 text-sm text-gray-300 italic opacity-80">
            <span className="pr-2">…</span>
            {partial}
            <span className="animate-pulse pl-1">▍</span>
          </div>
        )}
        {error && <div className="text-red-400 text-sm">{error}</div>}
      </div>
    </div>
  );
}
