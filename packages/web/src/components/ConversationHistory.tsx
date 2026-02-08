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
  const [expandedDays, setExpandedDays] = useState<Set<string>>(new Set(["Today"]));
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
          <span style={{ fontSize: 13, color: "rgba(201,209,217,0.25)", fontWeight: 300 }}>
            {detailLabel}
          </span>
        </div>
        <div
          className="scrollbar-discreet"
          style={{ flex: 1, overflowY: "auto", padding: 20 }}
        >
          {selectedConvo.messages.map((msg, i) => (
            <div
              key={i}
              style={{
                display: "flex",
                marginBottom: 12,
                justifyContent: msg.role === "user" ? "flex-end" : "flex-start",
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
            </div>
          ))}
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
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          padding: "16px 20px",
          borderBottom: "1px solid rgba(255,255,255,0.06)",
        }}
      >
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
            No conversations yet. Start talking to Kira!
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
                          {convo._count.messages} messages · {formatDate(convo.createdAt)}
                        </div>
                      </div>
                      <ChevronRight
                        size={14}
                        style={{ color: "rgba(201,209,217,0.1)", flexShrink: 0 }}
                      />
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
