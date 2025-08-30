"use client";

import { useEffect, useMemo } from 'react';
import { useConversation } from '@/lib/state/ConversationProvider';
import { Plus, MessageSquare } from 'lucide-react';

export default function Sidebar() {
  const { allConversations, currentConversationId, loadConversation, newConversation, fetchAllConversations, startConversation } = useConversation();
  const convos = allConversations;
  const activeId = currentConversationId ?? null;
  const isLoading = useMemo(() => false, []);

  useEffect(() => { fetchAllConversations(); }, [fetchAllConversations]);

  return (
    <aside className="hidden md:flex flex-col w-64 bg-gray-900/50 border-r border-white/10 h-screen sticky top-0">
      <div className="p-2 border-b border-white/10">
        <button
          onClick={async () => { await newConversation(); startConversation(); }}
          className="w-full flex items-center gap-2 px-3 py-2 rounded-md text-sm font-medium text-white bg-fuchsia-600 hover:bg-fuchsia-700 transition-colors"
        >
          <Plus size={18} />
          New Conversation
        </button>
      </div>
      <div className="flex-1 overflow-y-auto p-2 space-y-1">
        {isLoading && <p className="text-xs text-gray-400 px-2">Loading...</p>}
        {convos.map((convo) => (
          <div
            key={convo.id}
            onClick={() => loadConversation(convo.id)}
            className={`group flex items-center justify-between gap-3 px-3 py-2 rounded-md text-sm truncate cursor-pointer ${
              activeId === convo.id ? 'bg-white/10' : 'hover:bg-white/5 text-gray-300'
            }`}
          >
            <div className="flex items-center gap-3 truncate">
              <MessageSquare size={16} className="shrink-0" />
              <span className="truncate">{convo.title || 'New Conversation'}</span>
            </div>
          </div>
        ))}
      </div>
    </aside>
  );
}
