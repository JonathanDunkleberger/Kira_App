"use client";

import { useEffect, useState } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { clearAllConversations, createConversation, deleteConversation, listConversations } from '@/lib/client-api';
import { supabase } from '@/lib/supabaseClient';

type Convo = { id: string; title: string; updated_at: string };

export default function Sidebar() {
  const router = useRouter();
  const search = useSearchParams();
  const activeId = search.get('c');
  const [convos, setConvos] = useState<Convo[]>([]);
  const [signedIn, setSignedIn] = useState(false);
  const [loading, setLoading] = useState(true);

  async function refresh() {
    const { data: { session } } = await supabase.auth.getSession();
    setSignedIn(!!session);
    if (!session) { setConvos([]); setLoading(false); return; }
    const list = await listConversations().catch(() => []);
    setConvos(list);
    setLoading(false);
  }

  useEffect(() => { refresh(); }, []);

  if (!signedIn) return null;

  return (
    <aside className="hidden md:flex md:flex-col w-64 shrink-0 border-r border-white/10 min-h-[calc(100vh-56px)] sticky top-14 bg-[#0b0b12]">
      <div className="p-3 flex items-center gap-2 border-b border-white/10">
        <button
          className="px-3 py-1.5 rounded bg-violet-600 hover:bg-violet-500 text-sm"
          onClick={async () => {
            const c = await createConversation().catch(() => null);
            if (c) {
              setConvos((prev) => [c, ...prev]);
              const url = new URL(window.location.href);
              url.searchParams.set('c', c.id);
              router.replace(url.toString());
            }
          }}
        >
          New chat
        </button>
        {convos.length > 0 && (
          <button
            className="px-2 py-1 rounded text-xs text-gray-300 hover:text-white border border-white/10"
            onClick={async () => {
              if (!confirm('Clear all conversations?')) return;
              await clearAllConversations().catch(() => {});
              setConvos([]);
              const url = new URL(window.location.href);
              url.searchParams.delete('c');
              router.replace(url.toString());
            }}
          >
            Clear all
          </button>
        )}
      </div>
      <div className="flex-1 overflow-y-auto">
        {loading ? (
          <div className="p-3 text-xs text-gray-400">Loading...</div>
        ) : convos.length === 0 ? (
          <div className="p-3 text-xs text-gray-400">No conversations yet</div>
        ) : (
          <ul className="py-2">
            {convos.map((c) => (
              <li key={c.id} className={`group flex items-center justify-between gap-2 px-3 py-2 cursor-pointer text-sm ${activeId === c.id ? 'bg-white/5' : 'hover:bg-white/5'}`}
                  onClick={() => {
                    const url = new URL(window.location.href);
                    url.searchParams.set('c', c.id);
                    router.replace(url.toString());
                  }}
              >
                <div className="truncate">{c.title || 'Untitled'}</div>
                <button
                  className="opacity-0 group-hover:opacity-100 text-xs text-gray-400 hover:text-rose-400"
                  onClick={async (e) => {
                    e.stopPropagation();
                    await deleteConversation(c.id).catch(() => {});
                    setConvos((prev) => prev.filter((x) => x.id !== c.id));
                    if (activeId === c.id) {
                      const url = new URL(window.location.href);
                      url.searchParams.delete('c');
                      router.replace(url.toString());
                    }
                  }}
                  title="Delete"
                >
                  ×
                </button>
              </li>
            ))}
          </ul>
        )}
      </div>
    </aside>
  );
}
