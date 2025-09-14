"use client";
import { useEffect, useRef, useState } from "react";
import { notFound } from "next/navigation";

export default function ConversationPage({ params }: { params: { conversationId: string } }) {
  const { conversationId } = params;
  if (!conversationId) {
    notFound();
  }

  const wsRef = useRef<WebSocket | null>(null);
  const [status, setStatus] = useState("connecting");
  const [events, setEvents] = useState<string[]>([]);

  useEffect(() => {
    const url = (process.env.NEXT_PUBLIC_WS_URL || "ws://localhost:3001") + `?conversationId=${conversationId}`;
    const ws = new WebSocket(url);
    wsRef.current = ws;

    ws.onopen = () => {
      setStatus("open");
      ws.send(JSON.stringify({ type: "client_ready", conversationId }));
    };
    ws.onmessage = (ev) => {
      setEvents((prev) => [...prev, ev.data]);
    };
    ws.onclose = () => setStatus("closed");
    ws.onerror = () => setStatus("error");
    return () => ws.close();
  }, [conversationId]);

  return (
    <main className="p-6 flex flex-col gap-4">
      <h1 className="text-xl font-semibold">Conversation {conversationId}</h1>
      <div className="text-sm text-gray-500">WebSocket status: {status}</div>
      <div className="border rounded p-2 text-xs h-64 overflow-auto bg-gray-50 dark:bg-gray-900">
        {events.map((e, i) => (
          <div key={i}>{e}</div>
        ))}
      </div>
    </main>
  );
}
