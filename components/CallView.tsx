'use client';
import { useEffect, useState, useRef, useCallback } from 'react';
import { useConnection } from '../lib/useConnection';
import { useAudioCapture } from '../lib/useAudioCapture';
import { Button } from './ui/Button';

interface CallViewProps {
  conversationId: string;
  onEnd: () => void;
}

interface TranscriptMsg {
  role: string;
  text: string;
}

export function CallView({ conversationId, onEnd }: CallViewProps) {
  const [transcript, setTranscript] = useState<TranscriptMsg[]>([]);
  const [input, setInput] = useState('');
  const [muted, setMuted] = useState(false);
  const startTs = useRef<number>(Date.now());
  const [elapsed, setElapsed] = useState(0);

  // Verify env var presence once on mount (client-side)
  useEffect(() => {
    // Using both possible names in case of naming mismatch
    // eslint-disable-next-line no-console
    console.log(
      'VERIFYING ENV VAR: NEXT_PUBLIC_WEBSOCKET_URL =',
      process.env.NEXT_PUBLIC_WEBSOCKET_URL,
    );
    // eslint-disable-next-line no-console
    console.log('VERIFYING ENV VAR (legacy NEXT_PUBLIC_WS_URL) =', process.env.NEXT_PUBLIC_WS_URL);
  }, []);

  useEffect(() => {
    const id = setInterval(() => setElapsed(Date.now() - startTs.current), 1000);
    return () => clearInterval(id);
  }, []);

  const { state, send, close } = useConnection<{ type: string; text?: string; role?: string }>({
    url: () => {
      const base =
        process.env.NEXT_PUBLIC_WEBSOCKET_URL ||
        process.env.NEXT_PUBLIC_WS_URL ||
        'ws://localhost:3001';
      return `${base}?conversationId=${conversationId}`;
    },
    onMessage: (msg) => {
      if (msg.type === 'transcript' && msg.text) {
        setTranscript((t) => [...t, { role: msg.role || 'assistant', text: msg.text! }]);
      }
    },
  });

  const { rms } = useAudioCapture(!muted);

  useEffect(() => {
    if (state === 'open') {
      send({ type: 'client_ready', conversationId });
    }
  }, [state, send, conversationId]);

  const sendUser = useCallback(() => {
    if (!input.trim()) return;
    setTranscript((t) => [...t, { role: 'user', text: input.trim() }]);
    send({ type: 'user_message', text: input.trim(), conversationId });
    setInput('');
  }, [conversationId, input, send]);

  return (
    <div className="flex flex-col h-full">
      <div className="flex items-center justify-between mb-4 text-xs text-[var(--muted-text)]">
        <div className="flex items-center gap-2">
          <span>
            {state === 'open' && 'Connected'}
            {state === 'retry' && 'Reconnecting…'}
            {state === 'connecting' && 'Connecting…'}
            {state === 'closed' && 'Closed'}
          </span>
          <span className="inline-block h-2 w-2 rounded-full bg-[var(--accent)] animate-pulse" />
        </div>
        <div>{Math.floor(elapsed / 1000)}s</div>
      </div>
      <div className="flex-1 rounded-lg border border-black/10 dark:border-white/10 bg-[var(--surface)] p-4 overflow-auto space-y-3 text-sm">
        {transcript.length === 0 && (
          <div className="text-[var(--muted-text)]">Start speaking or type a message…</div>
        )}
        {transcript.map((m, i) => (
          <div key={i} className="flex gap-2">
            <span className="font-medium text-[var(--text)] min-w-[52px] text-right">
              {m.role === 'assistant' ? 'Kira' : 'You'}:
            </span>
            <span className="text-[var(--text)] whitespace-pre-wrap">{m.text}</span>
          </div>
        ))}
      </div>
      <div className="mt-4 flex gap-2">
        <input
          value={input}
          onChange={(e) => setInput(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter' && !e.shiftKey) {
              e.preventDefault();
              sendUser();
            }
          }}
          placeholder="Type a message…"
          className="flex-1 rounded-md border border-black/10 dark:border-white/10 bg-[var(--bg-muted)] px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-[var(--accent)]/40"
        />
        <Button onClick={sendUser} disabled={!input.trim() || state !== 'open'}>
          Send
        </Button>
      </div>
      <div className="mt-4 flex items-center gap-3 text-xs text-[var(--muted-text)]">
        <button
          onClick={() => setMuted((m) => !m)}
          className="px-3 py-1.5 rounded-md bg-[var(--accent)]/15 hover:bg-[var(--accent)]/25 text-[var(--text)]"
        >
          {muted ? 'Unmute' : 'Mute'}
        </button>
        <button
          onClick={() => {
            close();
            onEnd();
          }}
          className="px-3 py-1.5 rounded-md bg-[var(--danger)]/20 hover:bg-[var(--danger)]/30 text-[var(--danger)]"
        >
          End Call
        </button>
        <span>Mic {muted ? 'Muted' : rms > 0.02 ? 'Active' : 'Idle'}</span>
      </div>
    </div>
  );
}
