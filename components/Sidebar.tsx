"use client";

import { useEffect, useMemo, useState } from 'react';
import { useConversation } from '@/lib/state/ConversationProvider';
import { Plus, MessageSquare, Menu, Search, Settings } from 'lucide-react';

export default function Sidebar() {
  const { allConversations, currentConversationId, loadConversation, newConversation, fetchAllConversations, startConversation } = useConversation();
  const [isCollapsed, setIsCollapsed] = useState(false);
  const [searchTerm, setSearchTerm] = useState('');

  useEffect(() => { fetchAllConversations(); }, [fetchAllConversations]);

  const convos = allConversations;
  const activeId = currentConversationId ?? null;

  const recent = useMemo(() => {
    return [...convos]
      .sort((a, b) => (b.updated_at || '').localeCompare(a.updated_at || ''))
      .filter(c => {
        const t = (c.title || 'New Conversation').toLowerCase();
        return t.includes(searchTerm.toLowerCase());
      });
  }, [convos, searchTerm]);

  return (
    <aside className={`hidden md:flex flex-col h-screen sticky top-0 bg-gray-900/50 border-r border-white/10 transition-all duration-300 ${isCollapsed ? 'w-16' : 'w-64'}`}>
      {/* Top: toggle + new chat */}
      <div className="p-2 border-b border-white/10 flex items-center justify-between">
        <button
          onClick={() => setIsCollapsed(v => !v)}
          className="p-2 rounded-md hover:bg-white/5"
          title={isCollapsed ? 'Expand' : 'Collapse'}
          aria-label="Toggle sidebar"
        >
          <Menu size={18} />
        </button>
        {!isCollapsed && (
          <button
            onClick={async () => { await newConversation(); startConversation(); }}
            className="flex items-center gap-2 px-3 py-2 rounded-md text-sm font-medium text-white bg-fuchsia-600 hover:bg-fuchsia-700 transition-colors"
          >
            <Plus size={18} />
            New Chat
          </button>
        )}
      </div>

      {/* Search */}
      {!isCollapsed && (
        <div className="p-2 border-b border-white/10">
          <div className="relative">
            <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-white/50" />
            <input
              type="text"
              placeholder="Search chats..."
              className="w-full pl-9 pr-3 py-2 rounded-md bg-black/30 border border-white/10 text-sm placeholder-white/40 focus:outline-none focus:ring-1 focus:ring-fuchsia-600"
              value={searchTerm}
              onChange={(e) => setSearchTerm(e.target.value)}
            />
          </div>
        </div>
      )}

      {/* List */}
  <div className={`flex-1 overflow-y-auto p-2 ${isCollapsed ? '' : 'space-y-1'} custom-scrollbar scrollbar-hide scrollbar-hover`}>
        {!isCollapsed && (
          <>
            <h3 className="px-2 text-[11px] font-semibold uppercase tracking-wide text-white/50 mb-2">Recent</h3>
            {recent.length === 0 && (
              <p className="text-xs text-white/50 px-2">No chats found.</p>
            )}
            {recent.map((convo) => (
              <div
                key={convo.id}
                onClick={() => loadConversation(convo.id)}
                className={`group flex items-center justify-between gap-3 px-3 py-2 rounded-md text-sm truncate cursor-pointer transition-all duration-200 ease-in-out ${
                  activeId === convo.id ? 'bg-white/10' : 'hover:bg-white/10 hover:scale-[1.02] text-gray-300'
                }`}
              >
                <div className="flex items-center gap-3 truncate">
                  <MessageSquare size={16} className="shrink-0" />
                  <span className="truncate">{convo.title || 'New Conversation'}</span>
                </div>
              </div>
            ))}
          </>
        )}
      </div>

      {/* Footer */}
      <div className="p-2 border-t border-white/10">
        <a href="/account" className="flex items-center gap-2 px-3 py-2 rounded-md hover:bg-white/5" title={isCollapsed ? 'Settings & Help' : ''}>
          <Settings size={16} className="text-white/70" />
          {!isCollapsed && <span className="text-sm text-white/90">Settings & Help</span>}
        </a>
      </div>
    </aside>
  );
}
