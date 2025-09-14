'use client';
import { useEffect, useRef, useState, useCallback } from 'react';
import { notFound } from 'next/navigation';

import { Card, CardHeader, CardTitle, CardContent, CardFooter } from '../../../components/ui/card';
import { Button } from '../../../components/ui/Button';

export default function ConversationPage({ params }: { params: { conversationId: string } }) {
  const { conversationId } = params;
  if (!conversationId) {
    notFound();
  }

  const wsRef = useRef<WebSocket | null>(null);
  const [status, setStatus] = useState('connecting');
  const [events, setEvents] = useState<string[]>([]);
  const [messages, setMessages] = useState<{ role: string; text: string }[]>([]);
  const [input, setInput] = useState('');

  useEffect(() => {
    const url =
      (process.env.NEXT_PUBLIC_WS_URL || 'ws://localhost:3001') +
      `?conversationId=${conversationId}`;
    const ws = new WebSocket(url);
    wsRef.current = ws;

    ws.onopen = () => {
      setStatus('open');
      ws.send(JSON.stringify({ type: 'client_ready', conversationId }));
    };
    ws.onmessage = (ev) => {
      setEvents((prev) => [...prev, ev.data]);
      try {
        const parsed = JSON.parse(ev.data);
        if (parsed.type === 'transcript' && parsed.text) {
          setMessages((m) => [...m, { role: parsed.role || 'assistant', text: parsed.text }]);
        }
      } catch {
        // non-JSON event
      }
    };
    ws.onclose = () => setStatus('closed');
    ws.onerror = () => setStatus('error');
    return () => ws.close();
  }, [conversationId]);

  const sendMessage = useCallback(() => {
    if (!input.trim() || wsRef.current?.readyState !== WebSocket.OPEN) return;
    const payload = { type: 'user_message', text: input.trim(), conversationId };
    wsRef.current.send(JSON.stringify(payload));
    setMessages((m) => [...m, { role: 'user', text: input.trim() }]);
    setInput('');
  }, [input, conversationId]);

  return (
    <main className="min-h-screen p-4 md:p-8 flex flex-col gap-6 max-w-5xl mx-auto w-full">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-semibold tracking-tight">Conversation</h1>
        <span className="text-xs rounded-full px-3 py-1 bg-gray-200 dark:bg-neutral-800 text-gray-700 dark:text-gray-300 capitalize">
          {status}
        </span>
      </div>
      <div className="grid gap-6 md:grid-cols-3 grid-cols-1">
        <Card className="md:col-span-2 flex flex-col h-[70vh]">
          <CardHeader className="pb-4">
            <CardTitle className="text-lg">Transcript</CardTitle>
          </CardHeader>
          <CardContent className="flex-1 overflow-auto space-y-3 pr-2">
            {messages.length === 0 && (
              <div className="text-sm text-gray-500">
                No messages yet. Start speaking or type below.
              </div>
            )}
            {messages.map((m, i) => (
              <div key={i} className="flex gap-2 text-sm">
                <span className="font-medium text-gray-700 dark:text-gray-300 min-w-[60px] text-right">
                  {m.role === 'assistant' ? 'Kira' : 'You'}:
                </span>
                <span className="text-gray-800 dark:text-gray-200 whitespace-pre-wrap">
                  {m.text}
                </span>
              </div>
            ))}
          </CardContent>
          <CardFooter className="flex-col gap-3 items-stretch">
            <div className="flex gap-2 w-full">
              <input
                className="flex-1 rounded-md border border-gray-300 dark:border-neutral-700 bg-white dark:bg-neutral-900 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-primary/40"
                placeholder="Type a message..."
                value={input}
                onChange={(e) => setInput(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter' && !e.shiftKey) {
                    e.preventDefault();
                    sendMessage();
                  }
                }}
              />
              <Button onClick={sendMessage} disabled={status !== 'open' || !input.trim()}>
                Send
              </Button>
            </div>
            <div className="text-[10px] text-gray-500 self-end">
              Conversation ID: {conversationId}
            </div>
          </CardFooter>
        </Card>
        <div className="flex flex-col gap-6">
          <Card className="h-[34vh]">
            <CardHeader className="pb-2">
              <CardTitle className="text-sm">Debug Events</CardTitle>
            </CardHeader>
            <CardContent className="h-full overflow-auto text-[10px] font-mono leading-relaxed space-y-1">
              {events.slice(-300).map((e, i) => (
                <div key={i}>{e}</div>
              ))}
            </CardContent>
          </Card>
          <Card className="p-0">
            <CardHeader className="pb-2">
              <CardTitle className="text-sm">Controls</CardTitle>
            </CardHeader>
            <CardContent className="space-y-2 text-sm">
              <Button
                variant="ghost"
                onClick={() => {
                  if (wsRef.current && wsRef.current.readyState === WebSocket.OPEN) {
                    wsRef.current.close();
                  }
                }}
                disabled={status !== 'open'}
              >
                Disconnect
              </Button>
              <Button
                variant="outline"
                onClick={() => {
                  window.location.reload();
                }}
              >
                Reload
              </Button>
              <Button
                variant="subtle"
                onClick={() => {
                  navigator.clipboard.writeText(conversationId).catch(() => {});
                }}
              >
                Copy ID
              </Button>
            </CardContent>
          </Card>
        </div>
      </div>
    </main>
  );
}
