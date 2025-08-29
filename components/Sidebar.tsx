"use client";

import { useEffect, useState }from 'react';
import { useConversation } from '@/lib/state/ConversationProvider';
import { listConversations, createConversation } from '@/lib/client-api';
import { Plus, MessageSquare, Trash2 } from 'lucide-react';
import { supabase } from '@/lib/supabaseClient';

type Convo = { id: string; title: string | null; updated_at: string };

export default function Sidebar() {
  const [convos, setConvos] = useState<Convo[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const { conversationId, startConversation, stopConversation } = useConversation();

  const fetchConvos = async () => {
    setIsLoading(true);
    const conversationList = await listConversations();
    setConvos(conversationList);
    setIsLoading(false);
  };

  useEffect(() => {
    fetchConvos();
    // Subscribe to changes in the conversations table for real-time updates
    const channel = supabase.channel('conversations-sidebar')
      .on('postgres_changes', { event: '*', schema: 'public', table: 'conversations' }, (_payload) => {
        fetchConvos();
      })
      .subscribe();

    return () => {
      supabase.removeChannel(channel);
    };
  }, []);

  const handleNewChat = () => {
    if (conversationId) {
        stopConversation();
    }
    startConversation();
  };
  
  const handleDelete = async (e: React.MouseEvent, convoId: string) => {
      e.stopPropagation();
      if(confirm('Are you sure you want to delete this conversation?')){
          await supabase.from('conversations').delete().eq('id', convoId);
          fetchConvos();
          if(conversationId === convoId){
              stopConversation();
          }
      }
  }

  return (
    <aside className="hidden md:flex flex-col w-64 bg-gray-900/50 border-r border-white/10 h-screen sticky top-0">
      <div className="p-2 border-b border-white/10">
        <button
          onClick={handleNewChat}
          className="w-full flex items-center gap-2 px-3 py-2 rounded-md text-sm font-medium text-white bg-fuchsia-600 hover:bg-fuchsia-700 transition-colors"
        >
          <Plus size={18} />
          New Conversation
        </button>
      </div>
      <div className="flex-1 overflow-y-auto p-2 space-y-1">
        {isLoading && <p className="text-xs text-gray-400 px-2">Loading...</p>}
        {convos.map((convo) => (
          <a
            key={convo.id}
            href={`/?c=${convo.id}`} 
            className={`group flex items-center justify-between gap-3 px-3 py-2 rounded-md text-sm truncate cursor-pointer ${
              conversationId === convo.id ? 'bg-white/10' : 'hover:bg-white/5 text-gray-300'
            }`}
          >
            <div className="flex items-center gap-3 truncate">
                <MessageSquare size={16} className="shrink-0" />
                <span className="truncate">{convo.title || 'New Conversation'}</span>
            </div>
            <button onClick={(e) => handleDelete(e, convo.id)} className="opacity-0 group-hover:opacity-100 text-gray-400 hover:text-rose-400 transition-opacity">
                <Trash2 size={14} />
            </button>
          </a>
        ))}
      </div>
    </aside>
  );
}
