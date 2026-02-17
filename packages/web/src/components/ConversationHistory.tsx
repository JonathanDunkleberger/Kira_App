"use client";
import { useState, useEffect, useRef } from "react";
import { X, MessageCircle, ChevronRight, ArrowLeft, Trash2, Search } from "lucide-react";

interface ConversationPreview {
  id: string;
  createdAt: string;
  summary?: string | null;
  messages: Array<{ role: string; content: string }>;
  _count: { messages: number };
}

interface ConversationDetail {
  id: string;
  createdAt: string;
  messages: Array<{ role: string; content: string; createdAt?: string }>;
}

interface ConversationHistoryProps {
  onClose: () => void;
}

// Group conversations by day label
function groupByDay(convos: ConversationPreview[]): [string, ConversationPreview[]][] {
  const groups: Record<string, ConversationPreview[]> = {};
  const today = new Date();
  const yesterday = new Date(today);
  yesterday.setDate(yesterday.getDate() - 1);

  for (const c of convos) {
    const d = new Date(c.createdAt);
    let label: string;
    if (d.toDateString() === today.toDateString()) {
      label = "Today";
    } else if (d.toDateString() === yesterday.toDateString()) {
      label = "Yesterday";
    } else {
      label = d.toLocaleDateString("en-US", { weekday: "long", month: "long", day: "numeric" });
    }
    if (!groups[label]) groups[label] = [];
    groups[label].push(c);
  }
  return Object.entries(groups);
}

export default function ConversationHistory({ onClose }: ConversationHistoryProps) {
  const [conversations, setConversations] = useState<ConversationPreview[]>([]);
  const [selectedConvo, setSelectedConvo] = useState<ConversationDetail | null>(null);
  const [loading, setLoading] = useState(true);
  const [expandedDays, setExpandedDays] = useState<Set<string>>(new Set(["Today", "Yesterday"]));
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const [searchQuery, setSearchQuery] = useState("");
  const searchTimeout = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Fetch conversations (with optional search)
  const fetchConversations = (query?: string) => {
    setLoading(true);
    const url = query && query.length >= 2
      ? `/api/conversations?q=${encodeURIComponent(query)}`
      : "/api/conversations";
    fetch(url)
      .then((r) => r.json())
      .then((data) => {
        if (Array.isArray(data)) {
          setConversations(data);
        }
        setLoading(false);
      })
      .catch(() => setLoading(false));
  };

  useEffect(() => {
    fetchConversations();
  }, []);

  // Debounced search
  const handleSearch = (value: string) => {
    setSearchQuery(value);
    if (searchTimeout.current) clearTimeout(searchTimeout.current);
    searchTimeout.current = setTimeout(() => {
      fetchConversations(value);
    }, 300); // 300ms debounce
  };

  const loadConversation = async (id: string) => {
    const res = await fetch(`/api/conversations/${id}`);
    const data = await res.json();
    setSelectedConvo(data);
  };

  const deleteConversation = async (id: string, e: React.MouseEvent) => {
    e.stopPropagation(); // Don't open the conversation

    if (!window.confirm("Delete this conversation? This can't be undone.")) return;

    try {
      const res = await fetch(`/api/conversations/${id}`, { method: "DELETE" });
      if (res.ok) {
        setConversations(prev => prev.filter(c => c.id !== id));
      }
    } catch (err) {
      console.error("Failed to delete conversation:", err);
    }
  };

  const toggleDay = (label: string) => {
    setExpandedDays((prev) => {
      const next = new Set(prev);
      if (next.has(label)) next.delete(label);
      else next.add(label);
      return next;
    });
  };

  const formatDate = (dateStr: string) => {
    const d = new Date(dateStr);
    return d.toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit" });
  };

  /** Estimate conversation duration from message count and show as time range. */
  const formatTimeRange = (convo: ConversationPreview) => {
    const start = new Date(convo.createdAt);
    const startStr = start.toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit" });
    // Rough estimate: ~20s per message exchange
    const estimatedMinutes = Math.max(1, Math.round(convo._count.messages * 20 / 60));
    return `${startStr} · ${estimatedMinutes} min`;
  };

  /** Relative timestamp for messages within a conversation (e.g. +2m, +1h 5m). */
  const formatRelativeTime = (msgDate: string, convoStart: string) => {
    const msgTime = new Date(msgDate).getTime();
    const startTime = new Date(convoStart).getTime();
    const diffMin = Math.round((msgTime - startTime) / 60000);

    if (diffMin <= 0) return "";
    if (diffMin < 60) return `+${diffMin}m`;
    const hrs = Math.floor(diffMin / 60);
    const mins = diffMin % 60;
    return `+${hrs}h${mins > 0 ? ` ${mins}m` : ""}`;
  };

  const getPreview = (convo: ConversationPreview) => {
    // Prefer AI-generated summary over raw first message
    if (convo.summary) return convo.summary;
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
    const detailDate = new Date(selectedConvo.createdAt);
    const detailLabel = detailDate.toLocaleDateString("en-US", {
      weekday: "long",
      month: "long",
      day: "numeric",
    });

    return (
      <div
        style={{
          position: "fixed",
          inset: 0,
          background: "#0D1117",
          zIndex: 1000,
          display: "flex",
          flexDirection: "column",
          overflow: "hidden",
          fontFamily: "'DM Sans', -apple-system, BlinkMacSystemFont, sans-serif",
        }}
      >
        <div
          style={{
            display: "flex",
            alignItems: "center",
            justifyContent: "space-between",
            padding: "16px 20px",
            borderBottom: "1px solid rgba(255,255,255,0.06)",
          }}
        >
          <button
            onClick={() => setSelectedConvo(null)}
            style={{
              background: "transparent",
              border: "none",
              color: "#8B9DC3",
              cursor: "pointer",
              display: "flex",
              alignItems: "center",
              gap: 6,
              fontSize: 14,
              fontFamily: "'DM Sans', sans-serif",
              padding: 0,
            }}
          >
            <ArrowLeft size={18} /> Back
          </button>
          <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
            <span style={{ fontSize: 13, color: "rgba(201,209,217,0.25)", fontWeight: 300 }}>
              {detailLabel}
            </span>
            <button
              onClick={async () => {
                if (!window.confirm("Delete this conversation? This can't be undone.")) return;
                try {
                  const res = await fetch(`/api/conversations/${selectedConvo.id}`, { method: "DELETE" });
                  if (res.ok) {
                    setConversations(prev => prev.filter(c => c.id !== selectedConvo.id));
                    setSelectedConvo(null); // Go back to list
                  }
                } catch (err) {
                  console.error("Failed to delete:", err);
                }
              }}
              style={{
                background: "transparent",
                border: "none",
                cursor: "pointer",
                padding: 4,
                color: "rgba(201,209,217,0.3)",
                transition: "color 0.15s",
              }}
              onMouseEnter={(e) => { e.currentTarget.style.color = "#e55"; }}
              onMouseLeave={(e) => { e.currentTarget.style.color = "rgba(201,209,217,0.3)"; }}
              title="Delete conversation"
            >
              <Trash2 size={16} />
            </button>
          </div>
        </div>
        <div
          className="scrollbar-discreet"
          style={{ flex: 1, overflowY: "auto", padding: 20 }}
        >
          {selectedConvo.messages.map((msg, i) => {
              const relTime = msg.createdAt
                ? formatRelativeTime(msg.createdAt, selectedConvo.createdAt)
                : "";

              return (
                <div
                  key={i}
                  style={{
                    display: "flex",
                    flexDirection: "column",
                    marginBottom: 12,
                    alignItems: msg.role === "user" ? "flex-end" : "flex-start",
                  }}
                >
                  <div
                    style={{
                      maxWidth: "80%",
                      padding: "10px 16px",
                      borderRadius: 14,
                      fontSize: 14,
                      lineHeight: 1.6,
                      color: "#C9D1D9",
                      background:
                        msg.role === "user"
                          ? "rgba(107,125,179,0.15)"
                          : "rgba(255,255,255,0.04)",
                    }}
                  >
                    {msg.content}
                  </div>
                  {relTime && (
                    <span
                      style={{
                        fontSize: 11,
                        color: "rgba(201,209,217,0.15)",
                        marginTop: 2,
                        paddingLeft: msg.role === "user" ? 0 : 8,
                        paddingRight: msg.role === "user" ? 8 : 0,
                      }}
                    >
                      {relTime}
                    </span>
                  )}
                </div>
              );
            })}
          <div ref={messagesEndRef} />
        </div>
      </div>
    );
  }

  // List view — grouped by day
  const grouped = groupByDay(conversations);

  return (
    <div
      style={{
        position: "fixed",
        inset: 0,
        background: "#0D1117",
        zIndex: 1000,
        display: "flex",
        flexDirection: "column",
        overflow: "hidden",
        fontFamily: "'DM Sans', -apple-system, BlinkMacSystemFont, sans-serif",
      }}
    >
      {/* Header */}
      <div
        style={{
          padding: "16px 20px 12px",
          borderBottom: "1px solid rgba(255,255,255,0.06)",
        }}
      >
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 12 }}>
          <span
            style={{
              fontSize: 18,
              fontFamily: "'Playfair Display', serif",
              fontWeight: 400,
              color: "#E2E8F0",
            }}
          >
            Past Conversations
          </span>
          <button
            onClick={onClose}
            style={{
              background: "transparent",
              border: "none",
              color: "#8B9DC3",
              cursor: "pointer",
              padding: 4,
            }}
          >
            <X size={20} />
          </button>
        </div>
        {/* Search bar */}
        <div style={{ position: "relative" }}>
          <Search
            size={14}
            style={{
              position: "absolute",
              left: 10,
              top: "50%",
              transform: "translateY(-50%)",
              color: "rgba(201,209,217,0.2)",
              pointerEvents: "none",
            }}
          />
          <input
            type="text"
            placeholder="Search conversations..."
            value={searchQuery}
            onChange={(e) => handleSearch(e.target.value)}
            style={{
              width: "100%",
              padding: "8px 12px 8px 32px",
              borderRadius: 8,
              border: "1px solid rgba(255,255,255,0.06)",
              background: "rgba(255,255,255,0.03)",
              color: "#C9D1D9",
              fontSize: 13,
              fontFamily: "'DM Sans', sans-serif",
              fontWeight: 300,
              outline: "none",
              transition: "border-color 0.15s",
              boxSizing: "border-box",
            }}
            onFocus={(e) => { e.currentTarget.style.borderColor = "rgba(107,125,179,0.3)"; }}
            onBlur={(e) => { e.currentTarget.style.borderColor = "rgba(255,255,255,0.06)"; }}
          />
          {searchQuery && (
            <button
              onClick={() => { setSearchQuery(""); fetchConversations(); }}
              style={{
                position: "absolute",
                right: 8,
                top: "50%",
                transform: "translateY(-50%)",
                background: "transparent",
                border: "none",
                color: "rgba(201,209,217,0.3)",
                cursor: "pointer",
                padding: 2,
                display: "flex",
                alignItems: "center",
              }}
            >
              <X size={12} />
            </button>
          )}
        </div>
      </div>

      {/* Body */}
      <div
        className="scrollbar-discreet"
        style={{ flex: 1, overflowY: "auto", padding: "4px 16px" }}
      >
        {loading ? (
          <div style={{ textAlign: "center", color: "rgba(201,209,217,0.25)", paddingTop: 60, fontSize: 14 }}>
            Loading...
          </div>
        ) : conversations.length === 0 ? (
          <div style={{ textAlign: "center", color: "rgba(201,209,217,0.25)", paddingTop: 60, fontSize: 14 }}>
            {searchQuery
              ? `No conversations matching "${searchQuery}"`
              : "No conversations yet. Start talking to Kira!"}
          </div>
        ) : (
          grouped.map(([dayLabel, convos]) => (
            <div key={dayLabel}>
              {/* Day header — clickable */}
              <button
                onClick={() => toggleDay(dayLabel)}
                style={{
                  width: "100%",
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "space-between",
                  padding: "14px 12px",
                  background: "transparent",
                  border: "none",
                  borderBottom: "1px solid rgba(255,255,255,0.04)",
                  cursor: "pointer",
                  fontFamily: "'DM Sans', sans-serif",
                }}
              >
                <span
                  style={{
                    fontSize: 13,
                    fontWeight: 500,
                    color: "#8B9DC3",
                    letterSpacing: "0.02em",
                  }}
                >
                  {dayLabel}
                </span>
                <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                  <span
                    style={{
                      fontSize: 12,
                      color: "rgba(201,209,217,0.25)",
                      fontWeight: 300,
                    }}
                  >
                    {convos.length} {convos.length === 1 ? "conversation" : "conversations"}
                  </span>
                  <ChevronRight
                    size={14}
                    style={{
                      color: "rgba(201,209,217,0.2)",
                      transform: expandedDays.has(dayLabel) ? "rotate(90deg)" : "rotate(0deg)",
                      transition: "transform 0.2s ease",
                    }}
                  />
                </div>
              </button>

              {/* Conversation rows — collapsible */}
              {expandedDays.has(dayLabel) && (
                <div style={{ paddingLeft: 8 }}>
                  {convos.map((convo) => (
                    <button
                      key={convo.id}
                      onClick={() => loadConversation(convo.id)}
                      style={{
                        width: "100%",
                        display: "flex",
                        alignItems: "center",
                        gap: 12,
                        padding: "12px 12px",
                        background: "transparent",
                        border: "none",
                        borderBottom: "1px solid rgba(255,255,255,0.02)",
                        cursor: "pointer",
                        textAlign: "left",
                        transition: "background 0.15s",
                        fontFamily: "'DM Sans', sans-serif",
                      }}
                      onMouseEnter={(e) => { e.currentTarget.style.background = "rgba(255,255,255,0.03)"; }}
                      onMouseLeave={(e) => { e.currentTarget.style.background = "transparent"; }}
                    >
                      <MessageCircle
                        size={16}
                        style={{ color: "rgba(201,209,217,0.15)", flexShrink: 0 }}
                      />
                      <div style={{ flex: 1, minWidth: 0 }}>
                        <div
                          style={{
                            fontSize: 14,
                            color: "#C9D1D9",
                            whiteSpace: "nowrap",
                            overflow: "hidden",
                            textOverflow: "ellipsis",
                          }}
                        >
                          {getPreview(convo)}
                        </div>
                        <div
                          style={{
                            fontSize: 12,
                            color: "rgba(201,209,217,0.2)",
                            marginTop: 2,
                          }}
                        >
                          {convo._count.messages} messages · {formatTimeRange(convo)}
                        </div>
                      </div>
                      <div style={{ display: "flex", alignItems: "center", gap: 4, flexShrink: 0 }}>
                        <button
                          onClick={(e) => deleteConversation(convo.id, e)}
                          style={{
                            background: "transparent",
                            border: "none",
                            cursor: "pointer",
                            padding: 4,
                            borderRadius: 4,
                            display: "flex",
                            alignItems: "center",
                            opacity: 0.3,
                            transition: "opacity 0.15s",
                          }}
                          onMouseEnter={(e) => { e.currentTarget.style.opacity = "0.8"; }}
                          onMouseLeave={(e) => { e.currentTarget.style.opacity = "0.3"; }}
                          title="Delete conversation"
                        >
                          <Trash2 size={14} style={{ color: "#e55" }} />
                        </button>
                        <ChevronRight
                          size={14}
                          style={{ color: "rgba(201,209,217,0.1)" }}
                        />
                      </div>
                    </button>
                  ))}
                </div>
              )}
            </div>
          ))
        )}
      </div>
    </div>
  );
}
