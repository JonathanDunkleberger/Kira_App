"use client";
import { useState, useEffect, useRef } from "react";
import { X, MessageCircle, ChevronRight, ArrowLeft } from "lucide-react";

interface ConversationPreview {
  id: string;
  createdAt: string;
  messages: Array<{ role: string; content: string }>;
  _count: { messages: number };
}

interface ConversationDetail {
  id: string;
  createdAt: string;
  messages: Array<{ role: string; content: string }>;
}

interface ConversationHistoryProps {
  onClose: () => void;
}

export default function ConversationHistory({ onClose }: ConversationHistoryProps) {
  const [conversations, setConversations] = useState<ConversationPreview[]>([]);
  const [selectedConvo, setSelectedConvo] = useState<ConversationDetail | null>(null);
  const [loading, setLoading] = useState(true);
  const messagesEndRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    fetch("/api/conversations")
      .then((r) => r.json())
      .then((data) => {
        setConversations(data);
        setLoading(false);
      })
      .catch(() => setLoading(false));
  }, []);

  const loadConversation = async (id: string) => {
    const res = await fetch(`/api/conversations/${id}`);
    const data = await res.json();
    setSelectedConvo(data);
  };

  const formatDate = (dateStr: string) => {
    const d = new Date(dateStr);
    const now = new Date();
    const diffDays = Math.floor(
      (now.getTime() - d.getTime()) / (1000 * 60 * 60 * 24)
    );
    if (diffDays === 0) return "Today";
    if (diffDays === 1) return "Yesterday";
    if (diffDays < 7) return `${diffDays} days ago`;
    return d.toLocaleDateString("en-US", { month: "short", day: "numeric" });
  };

  const getPreview = (convo: ConversationPreview) => {
    const userMsg = convo.messages.find((m) => m.role === "user");
    if (userMsg)
      return (
        userMsg.content.slice(0, 80) +
        (userMsg.content.length > 80 ? "..." : "")
      );
    return "Conversation";
  };

  // Detail view
  if (selectedConvo) {
    return (
      <div className="fixed inset-0 bg-[#0D1117] dark:bg-tokyo-bg z-[1000] flex flex-col overflow-hidden">
        <div className="flex items-center justify-between px-5 py-4 border-b border-white/[0.06]">
          <button
            onClick={() => setSelectedConvo(null)}
            className="bg-transparent border-none text-[#8B9DC3] cursor-pointer flex items-center gap-1.5 text-sm hover:text-white transition-colors"
          >
            <ArrowLeft size={18} /> Back
          </button>
          <span className="text-[13px] text-[#4A5A6A]">
            {formatDate(selectedConvo.createdAt)}
          </span>
        </div>
        <div className="flex-1 overflow-y-auto p-5 scrollbar-discreet">
          {selectedConvo.messages.map((msg, i) => (
            <div
              key={i}
              className={`flex mb-3 ${
                msg.role === "user" ? "justify-end" : "justify-start"
              }`}
            >
              <div
                className={`max-w-[80%] px-4 py-2.5 rounded-[14px] text-sm leading-relaxed text-[#C9D1D9] ${
                  msg.role === "user"
                    ? "bg-[rgba(107,125,179,0.15)]"
                    : "bg-white/[0.04]"
                }`}
              >
                {msg.content}
              </div>
            </div>
          ))}
          <div ref={messagesEndRef} />
        </div>
      </div>
    );
  }

  // List view
  return (
    <div className="fixed inset-0 bg-[#0D1117] dark:bg-tokyo-bg z-[1000] flex flex-col overflow-hidden">
      <div className="flex items-center justify-between px-5 py-4 border-b border-white/[0.06]">
        <span className="text-base font-medium text-[#C9D1D9]">
          Past Conversations
        </span>
        <button
          onClick={onClose}
          className="bg-transparent border-none text-[#6B7DB3] cursor-pointer hover:text-white transition-colors"
        >
          <X size={20} />
        </button>
      </div>
      <div className="flex-1 overflow-y-auto px-4 py-3 scrollbar-discreet">
        {loading ? (
          <div className="text-center text-[#4A5A6A] pt-[60px]">
            Loading...
          </div>
        ) : conversations.length === 0 ? (
          <div className="text-center text-[#4A5A6A] pt-[60px] text-sm">
            No conversations yet. Start talking to Kira!
          </div>
        ) : (
          conversations.map((convo) => (
            <button
              key={convo.id}
              onClick={() => loadConversation(convo.id)}
              className="w-full flex items-center gap-3 px-3 py-3.5 bg-transparent border-none border-b border-white/[0.04] cursor-pointer text-left transition-colors hover:bg-white/[0.03] group"
            >
              <MessageCircle
                size={18}
                className="text-[#4A5A6A] flex-shrink-0"
              />
              <div className="flex-1 min-w-0">
                <div className="text-sm text-[#C9D1D9] whitespace-nowrap overflow-hidden text-ellipsis">
                  {getPreview(convo)}
                </div>
                <div className="text-xs text-[#4A5A6A] mt-0.5">
                  {convo._count.messages} messages ·{" "}
                  {formatDate(convo.createdAt)}
                </div>
              </div>
              <ChevronRight
                size={16}
                className="text-gray-700 flex-shrink-0 group-hover:text-gray-400 transition-colors"
              />
            </button>
          ))
        )}
      </div>
    </div>
  );
}
