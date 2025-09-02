"use client";

import { useEffect, useMemo, useState } from 'react';
import { useConversation } from '@/lib/state/ConversationProvider';
import { Plus, MessageSquare, Menu, Search } from 'lucide-react';
import * as DropdownMenu from '@radix-ui/react-dropdown-menu';
import { GearIcon, QuestionMarkCircledIcon, ChatBubbleIcon, LoopIcon, TrashIcon, DotsHorizontalIcon, PinLeftIcon, Pencil2Icon, FileTextIcon, ChevronRightIcon, LockClosedIcon } from '@radix-ui/react-icons';
import { openBillingPortal, clearAllConversations, deleteConversation } from '@/lib/client-api';
import { supabase } from '@/lib/supabaseClient';
import Link from 'next/link';

export default function Sidebar() {
  const { allConversations, currentConversationId, loadConversation, newConversation, fetchAllConversations, startConversation, session, isPro } = useConversation();
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
              <DropdownMenu.Root key={convo.id}>
                <div
                  onClick={() => loadConversation(convo.id)}
                  className={`group relative flex items-center justify-between gap-3 px-3 py-2 rounded-md text-sm truncate cursor-pointer transition-colors ${
                    activeId === convo.id
                      ? 'bg-fuchsia-800/60'
                      : 'hover:bg-neutral-800 text-gray-300'
                  }`}
                >
                  {/* Conversation Title */}
                  <span className="truncate">{convo.title || 'New Conversation'}</span>

                  {/* 3-Dot Menu Trigger (appears on hover) */}
                  <DropdownMenu.Trigger asChild>
                    <button
                      onClick={(e) => e.stopPropagation()}
                      className="absolute right-2 top-1/2 -translate-y-1/2 p-1 rounded opacity-0 group-hover:opacity-100 hover:bg-neutral-700 focus:opacity-100"
                      aria-label="Chat options"
                    >
                      <DotsHorizontalIcon />
                    </button>
                  </DropdownMenu.Trigger>
                </div>

                {/* Dropdown Menu Content */}
                <DropdownMenu.Portal>
                  <DropdownMenu.Content
                    sideOffset={5}
                    align="start"
                    className="w-40 bg-neutral-800 border border-neutral-700 rounded-lg shadow-lg text-white text-sm z-50 p-1"
                  >
                    <DropdownMenu.Item
                      onSelect={() => console.log('Pinning:', convo.id)}
                      className="flex items-center gap-3 p-2 rounded hover:bg-fuchsia-600 cursor-pointer outline-none"
                    >
                      <PinLeftIcon /> Pin
                    </DropdownMenu.Item>
                    <DropdownMenu.Item
                      onSelect={async () => {
                        const next = window.prompt('Rename conversation', convo.title || '');
                        if (next == null) return; // cancelled
                        const title = next.trim();
                        if (!title || title === (convo.title || '')) return;
                        const { data: { session } } = await supabase.auth.getSession();
                        if (!session) { alert('Please sign in to rename.'); return; }
                        const r = await fetch(`/api/conversations/${convo.id}`, {
                          method: 'PATCH',
                          headers: {
                            'Content-Type': 'application/json',
                            Authorization: `Bearer ${session.access_token}`,
                          },
                          body: JSON.stringify({ title }),
                        });
                        if (!r.ok) {
                          try { const j = await r.json(); alert(j?.error || 'Failed to rename'); }
                          catch { alert('Failed to rename'); }
                          return;
                        }
                        // refresh list to show new title
                        try { await fetchAllConversations(); } catch {}
                      }}
                      className="flex items-center gap-3 p-2 rounded hover:bg-fuchsia-600 cursor-pointer outline-none"
                    >
                      <Pencil2Icon /> Rename
                    </DropdownMenu.Item>
                    <DropdownMenu.Separator className="h-[1px] bg-neutral-700 my-1" />
                    <DropdownMenu.Item
                      onSelect={async () => {
                        if (window.confirm('Are you sure you want to delete this conversation?')) {
                          try {
                            await deleteConversation(convo.id);
                            // If the active conversation was deleted, a full reload is simplest
                            if (activeId === convo.id) {
                              window.location.reload();
                              return;
                            }
                            await fetchAllConversations();
                          } catch (e) {
                            alert('Failed to delete conversation.');
                          }
                        }
                      }}
                      className="flex items-center gap-3 p-2 rounded text-red-400 hover:bg-red-500/20 cursor-pointer outline-none"
                    >
                      <TrashIcon /> Delete
                    </DropdownMenu.Item>
                  </DropdownMenu.Content>
                </DropdownMenu.Portal>
              </DropdownMenu.Root>
            ))}
          </>
        )}
      </div>

      {/* Footer: Settings & Help menu (DropdownMenu only) */}
      <div className="p-4 border-t border-neutral-800">
        <DropdownMenu.Root>
          <DropdownMenu.Trigger asChild>
            <button 
              className="flex w-full items-center gap-3 p-2 rounded-lg hover:bg-neutral-800 transition-colors" 
              title={isCollapsed ? "Settings" : ""}
            >
              <GearIcon className="h-5 w-5 text-neutral-400" />
              {!isCollapsed && <span>Settings & Help</span>}
            </button>
          </DropdownMenu.Trigger>
          <DropdownMenu.Portal>
            <DropdownMenu.Content 
              side="top" 
              align="start" 
              sideOffset={10}
              className="w-60 bg-neutral-900 border border-neutral-700 rounded-lg shadow-lg text-white text-sm z-50 p-1"
            >
              {/* Manage Subscription (Only for Pro users) */}
              {isPro && (
                <DropdownMenu.Item onSelect={openBillingPortal} className="flex items-center gap-3 p-2 rounded hover:bg-neutral-800 cursor-pointer outline-none">
                  <LoopIcon className="w-4 h-4" /> Manage Subscription
                </DropdownMenu.Item>
              )}

              {/* Clear History (Only for logged-in users) */}
              {session && (
                <DropdownMenu.Item onSelect={clearAllConversations} className="flex items-center gap-3 p-2 rounded text-red-400 hover:bg-red-500/20 cursor-pointer outline-none">
                  <TrashIcon className="w-4 h-4" /> Clear Chat History
                </DropdownMenu.Item>
              )}

              <DropdownMenu.Separator className="h-[1px] bg-neutral-800 my-1" />

              {/* Send Feedback */}
              <DropdownMenu.Item asChild>
                <a href="https://tally.so/r/w7yeRZ" target="_blank" rel="noopener noreferrer" className="flex items-center gap-3 p-2 rounded hover:bg-neutral-800 cursor-pointer outline-none">
                  <ChatBubbleIcon className="w-4 h-4" /> Send Feedback
                </a>
              </DropdownMenu.Item>

              {/* Nested Help Submenu */}
              <DropdownMenu.Sub>
                <DropdownMenu.SubTrigger className="flex w-full items-center justify-between gap-3 p-2 rounded hover:bg-neutral-800 cursor-pointer outline-none">
                  <div className="flex items-center gap-3">
                    <QuestionMarkCircledIcon className="w-4 h-4" /> Help
                  </div>
                  <ChevronRightIcon className="w-4 h-4" />
                </DropdownMenu.SubTrigger>
                <DropdownMenu.Portal>
                  <DropdownMenu.SubContent 
                    sideOffset={10} 
                    alignOffset={-5}
                    className="w-48 bg-neutral-800 border border-neutral-700 rounded-lg shadow-lg text-white text-sm z-50 p-1"
                  >
                    <DropdownMenu.Item asChild>
                      <Link href="/privacy" className="flex items-center gap-3 p-2 rounded hover:bg-fuchsia-600 cursor-pointer outline-none">
                        <LockClosedIcon className="w-4 h-4" /> Privacy Policy
                      </Link>
                    </DropdownMenu.Item>
                    <DropdownMenu.Item asChild>
                      <Link href="/terms" className="flex items-center gap-3 p-2 rounded hover:bg-fuchsia-600 cursor-pointer outline-none">
                        <FileTextIcon className="w-4 h-4" /> Terms of Service
                      </Link>
                    </DropdownMenu.Item>
                  </DropdownMenu.SubContent>
                </DropdownMenu.Portal>
              </DropdownMenu.Sub>
            </DropdownMenu.Content>
          </DropdownMenu.Portal>
        </DropdownMenu.Root>
      </div>
    </aside>
  );
}
