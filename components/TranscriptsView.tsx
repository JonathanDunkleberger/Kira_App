'use client';

import { useEffect, useState } from 'react';

import { subscribeToConversation, unsubscribeFromConversation } from '../lib/realtime';
import { AnimatedMessage } from './AnimatedTranscript';

interface Message {
  role: 'user' | 'assistant';
  content: string;
  created_at: string;
}

interface TranscriptViewProps {
  conversationId: string | null;
  isOpen: boolean;
  onClose: () => void;
}

export default function TranscriptsView({ conversationId, isOpen, onClose }: TranscriptViewProps) {
  const [messages, setMessages] = useState<Message[]>([]);
  const [loading, setLoading] = useState(false);
  const [exporting, setExporting] = useState(false);

  useEffect(() => {
    if (isOpen && conversationId) {
      loadTranscript();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isOpen, conversationId]);

  useEffect(() => {
    if (!isOpen || !conversationId) return;
    const sub = subscribeToConversation(conversationId, (row: any) => {
      setMessages((prev) => [
        ...prev,
        { role: row.role, content: row.content, created_at: row.created_at },
      ]);
    });
    return () => unsubscribeFromConversation(sub);
  }, [isOpen, conversationId]);

  const loadTranscript = async () => {
    if (!conversationId) return;
    setLoading(true);
    try {
      const response = await fetch(`/api/conversations/${conversationId}/messages`);
      if (response.ok) {
        const data = await response.json();
        setMessages(data.messages || []);
      }
    } catch (error) {
      console.error('Failed to load transcript:', error);
    } finally {
      setLoading(false);
    }
  };

  const exportTranscript = async () => {
    if (!conversationId) return;
    setExporting(true);
    try {
      const transcript = messages
        .map((msg) => `${msg.role === 'user' ? 'You' : 'Kira'}: ${msg.content}`)
        .join('\n\n');
      const blob = new Blob([transcript], { type: 'text/plain' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `kira-transcript-${conversationId.slice(0, 8)}.txt`;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(url);
    } catch (error) {
      console.error('Failed to export transcript:', error);
    } finally {
      setExporting(false);
    }
  };

  const formatTime = (dateString: string) => {
    return new Date(dateString).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
  };

  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 z-50 bg-black/50 backdrop-blur-sm flex items-center justify-center p-4">
      <div className="bg-[#12101b] border border-white/10 rounded-2xl w-full max-w-2xl max-h-[80vh] flex flex-col">
        <div className="flex items-center justify-between p-6 border-b border-white/10">
          <h2 className="text-xl font-semibold">Conversation Transcript</h2>
          <div className="flex items-center gap-3">
            <button
              onClick={exportTranscript}
              disabled={exporting || messages.length === 0}
              className="px-3 py-1.5 rounded-lg bg-fuchsia-600 hover:bg-fuchsia-700 disabled:opacity-50 text-sm"
            >
              {exporting ? 'Exporting...' : 'Export'}
            </button>
            <button
              onClick={onClose}
              className="p-2 hover:bg-white/5 rounded-lg"
              aria-label="Close transcript"
            >
              ×
            </button>
          </div>
        </div>

        <div className="flex-1 overflow-y-auto p-6">
          {loading ? (
            <div className="text-center text-white/60">Loading transcript...</div>
          ) : messages.length === 0 ? (
            <div className="text-center text-white/60">No messages in this conversation</div>
          ) : (
            <div className="space-y-4">
              {messages.map((message, index) => (
                <AnimatedMessage key={index} message={message} index={index} />
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
