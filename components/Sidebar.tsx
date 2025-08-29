"use client";

import { useEffect, useState } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { clearAllConversations, createConversation, deleteConversation, listConversations } from '@/lib/client-api';
import { supabase } from '@/lib/supabaseClient';
import { Plus, MessageSquare, Trash2 } from 'lucide-react';

type Convo = { id: string; title: string | null; updated_at: string };

export default function Sidebar() {
  const router = useRouter();
  const search = useSearchParams();
  const activeId = search.get('c');
  const [convos, setConvos] = useState<Convo[]>([]);
  const [isLoading, setIsLoading] = useState(true);

  const fetchConvos = async () => {
    setIsLoading(true);
    const list = await listConversations().catch(() => []);
    setConvos(list);
    setIsLoading(false);
  };

  useEffect(() => {
    fetchConvos();
    const channel = supabase.channel('conversations-sidebar')
      .on('postgres_changes', { event: '*', schema: 'public', table: 'conversations' }, () => fetchConvos())
      .subscribe();
    return () => { supabase.removeChannel(channel); };
  }, []);

  return (
    <aside className="hidden md:flex flex-col w-64 bg-gray-900/50 border-r border-white/10 h-screen sticky top-0">
      <div className="p-2 border-b border-white/10">
        <button
          onClick={async () => {
            const c = await createConversation().catch(() => null);
            if (c) {
              setConvos((prev) => [c, ...prev]);
              const url = new URL(window.location.href);
              url.searchParams.set('c', c.id);
              router.replace(url.toString());
            }
          }}
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
            onClick={() => {
              const url = new URL(window.location.href);
              url.searchParams.set('c', convo.id);
              router.replace(url.toString());
            }}
            className={`group flex items-center justify-between gap-3 px-3 py-2 rounded-md text-sm truncate cursor-pointer ${
              activeId === convo.id ? 'bg-white/10' : 'hover:bg-white/5 text-gray-300'
            }`}
          >
            <div className="flex items-center gap-3 truncate">
              <MessageSquare size={16} className="shrink-0" />
              <span className="truncate">{convo.title || 'New Conversation'}</span>
            </div>
            <button
              onClick={async (e) => {
                e.stopPropagation();
                await deleteConversation(convo.id).catch(() => {});
                setConvos((prev) => prev.filter((x) => x.id !== convo.id));
                if (activeId === convo.id) {
                  const url = new URL(window.location.href);
                  url.searchParams.delete('c');
                  router.replace(url.toString());
                }
              }}
              className="opacity-0 group-hover:opacity-100 text-gray-400 hover:text-rose-400 transition-opacity"
            >
              <Trash2 size={14} />
            </button>
          </div>
        ))}
      </div>
    </aside>
  );
}
