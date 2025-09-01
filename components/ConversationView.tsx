"use client";

import { useEffect, useRef, useState } from 'react';
import { useConversation } from '@/lib/state/ConversationProvider';
import { Share2 } from 'lucide-react';

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
    <div ref={scrollRef} className="w-full max-w-4xl mx-auto p-4 h-[calc(100vh-350px)] overflow-y-auto custom-scrollbar">
      <div className="space-y-3">
        {messages.map((m, idx) => {
          const isAssistant = m.role === 'assistant';
          const prevUser = idx > 0 ? messages[idx - 1] : null;
          const canShare = isAssistant && prevUser?.role === 'user';
          const handleShare = async () => {
            try {
              const res = await fetch('/api/share', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ userMessage: prevUser?.content, kiraMessage: m.content })
              });
              if (!res.ok) throw new Error('Failed to generate image');
              const blob = await res.blob();
              const file = new File([blob], 'kira-share.png', { type: 'image/png' });
              if ((navigator as any).canShare && (navigator as any).canShare({ files: [file] })) {
                await (navigator as any).share({ files: [file], title: 'Chat with Kira' });
              } else {
                const url = URL.createObjectURL(blob);
                const a = document.createElement('a');
                a.href = url; a.download = 'kira-share.png'; document.body.appendChild(a); a.click(); a.remove();
                URL.revokeObjectURL(url);
              }
            } catch (e) {
              console.error(e);
            }
          };
          return (
            <div key={m.id} className={isAssistant ? 'text-fuchsia-200' : 'text-gray-200'}>
              <div className={`inline-flex items-start gap-2 px-3 py-2 rounded-lg ${isAssistant ? 'bg-fuchsia-900/30' : 'bg-white/5'}`}>
                <div>{isAssistant ? 'Kira: ' : 'You: '}{m.content}</div>
                {canShare && (
                  <button
                    onClick={handleShare}
                    title="Share"
                    className="ml-2 text-white/70 hover:text-white p-1 rounded hover:bg-white/10"
                    aria-label="Share this exchange"
                  >
                    <Share2 size={16} />
                  </button>
                )}
              </div>
            </div>
          );
        })}
        {messages.length === 0 && conversationStatus === 'active' && (
          <div className="text-center text-gray-400">Listening... Say something!</div>
        )}
        {error && <div className="text-red-400 text-sm">{error}</div>}
      </div>
    </div>
  );
}
