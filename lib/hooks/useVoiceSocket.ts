// Client-side WebSocket connection manager for voice streaming
// Establishes a WS connection and forwards audio frames via callbacks.

import { useEffect, useRef, useState } from 'react';
// No direct audio playback here; chunks are emitted via callbacks

export type SocketStatus = 'connecting' | 'connected' | 'disconnected';

type ServerMsg =
  | { type: 'ready' }
  | { type: 'transcript'; text: string }
  | { type: 'assistant_text'; text: string }
  | { type: 'audio_start' }
  | { type: 'audio_end' }
  | { type: 'usage_update' }
  | { type: 'error'; message: string };

type VoiceSocketOptions = {
  url?: string;
  onAudioChunk?: (chunk: ArrayBuffer) => void;
  onAudioStart?: () => void;
  onAudioEnd?: () => void;
  onTranscript?: (text: string) => void;
  onAssistantText?: (text: string) => void;
  onUsageUpdate?: () => void;
  conversationId?: string | null;
};

type LastEvent = { type: 'transcript' | 'assistant_text' | 'error' | 'raw'; text: string };

const WSS_URL = process.env.NODE_ENV === 'production'
  ? process.env.NEXT_PUBLIC_WEBSOCKET_URL_PROD
  : process.env.NEXT_PUBLIC_WEBSOCKET_URL;

export function useVoiceSocket(opts: VoiceSocketOptions | string = WSS_URL || '') {
  const socketRef = useRef<WebSocket | null>(null);
  const [status, setStatus] = useState<SocketStatus>('connecting');
  const [lastText, setLastText] = useState<string>('');
  const [lastEvent, setLastEvent] = useState<LastEvent | null>(null);
  const onAudioChunkRef = useRef<((chunk: ArrayBuffer) => void) | undefined>(undefined);
  const onAudioStartRef = useRef<(() => void) | undefined>(undefined);
  const onAudioEndRef = useRef<(() => void) | undefined>(undefined);
  const onTranscriptRef = useRef<((t: string) => void) | undefined>(undefined);
  const onAssistantRef = useRef<((t: string) => void) | undefined>(undefined);
  const onUsageUpdateRef = useRef<(() => void) | undefined>(undefined);
  const reconnectAttemptsRef = useRef(0);
  const shuttingDownRef = useRef(false);
  // Fencing to ignore late audio packets and end playback immediately on halt()
  const acceptFenceRef = useRef(0); // increment to reject any in-flight audio
  const currentStreamFenceRef = useRef(-1); // fence associated with current audio_start/end window
  const streamOpenRef = useRef(false);
  // Debounce for halt() to avoid double "end" transitions
  const haltedAtRef = useRef(0);

  // Normalize options
  const urlBase = typeof opts === 'string' ? opts : (opts.url || WSS_URL || '');
  const conversationId = typeof opts === 'string' ? undefined : opts.conversationId;
  useEffect(() => {
    if (typeof opts !== 'string') {
      onAudioChunkRef.current = opts.onAudioChunk;
      onAudioEndRef.current = opts.onAudioEnd;
  onAudioStartRef.current = opts.onAudioStart;
  onTranscriptRef.current = opts.onTranscript;
  onAssistantRef.current = opts.onAssistantText;
  onUsageUpdateRef.current = opts.onUsageUpdate;
    } else {
      onAudioChunkRef.current = undefined;
      onAudioEndRef.current = undefined;
  onAudioStartRef.current = undefined;
  onTranscriptRef.current = undefined;
  onAssistantRef.current = undefined;
  onUsageUpdateRef.current = undefined;
    }
  }, [opts]);

  useEffect(() => {
    // Require a conversationId before connecting
    if (!conversationId) {
      setStatus('disconnected');
      return;
    }
    shuttingDownRef.current = false;

    const connect = async () => {
      if (!urlBase) {
        // No URL configured; stay disconnected
        setStatus('disconnected');
        return;
      }
      // Add auth token if available via Supabase client
      let token = '';
      try {
  const { supabase } = await import('@/lib/client/supabaseClient');
        const { data } = await (supabase as any).auth.getSession();
        token = data?.session?.access_token || '';
      } catch {}

  const url = new URL(urlBase);
      if (token) url.searchParams.set('token', token);
  if (conversationId) url.searchParams.set('conversationId', conversationId);

      try {
        const ws = new WebSocket(url.toString());
        socketRef.current = ws;
        ws.binaryType = 'arraybuffer';
        setStatus('connecting');

        ws.onopen = () => {
          console.log('WS connected');
          console.log('✅ WebSocket connected for conversation:', conversationId);
          reconnectAttemptsRef.current = 0;
          if (!shuttingDownRef.current) setStatus('connected');
        };

        ws.onmessage = async (event: MessageEvent) => {
          if (shuttingDownRef.current) return;
          const data = event.data;
          try {
            if (data instanceof ArrayBuffer) {
              // Forward chunk immediately
              // Only forward if this binary belongs to the currently accepted stream
              if (streamOpenRef.current && currentStreamFenceRef.current === acceptFenceRef.current) {
                try { onAudioChunkRef.current?.(data); } catch {}
              }
            } else if (data instanceof Blob) {
              const ab = await data.arrayBuffer();
              if (streamOpenRef.current && currentStreamFenceRef.current === acceptFenceRef.current) {
                try { onAudioChunkRef.current?.(ab); } catch {}
              }
            } else if (typeof data === 'string') {
              const maybe = safeParse<ServerMsg>(data);
              if (maybe) {
                switch (maybe.type) {
                  case 'transcript':
                    setLastText(maybe.text);
                    setLastEvent({ type: 'transcript', text: maybe.text || '' });
                    try { onTranscriptRef.current?.(maybe.text); } catch {}
                    break;
                  case 'assistant_text':
                    setLastText(maybe.text);
                    setLastEvent({ type: 'assistant_text', text: maybe.text || '' });
                    try { onAssistantRef.current?.(maybe.text); } catch {}
                    break;
                  case 'audio_start':
                    // Start a new audio stream window with the current accept fence snapshot
                    currentStreamFenceRef.current = acceptFenceRef.current;
                    streamOpenRef.current = true;
                    // If this stream is accepted, notify start
                    if (currentStreamFenceRef.current === acceptFenceRef.current) {
                      try { onAudioStartRef.current?.(); } catch {}
                    }
                    break;
                  case 'audio_end':
                    // Only end and flush if the stream matches the accepted fence
                    if (streamOpenRef.current && currentStreamFenceRef.current === acceptFenceRef.current) {
                      try { onAudioEndRef.current?.(); } catch {}
                    }
                    streamOpenRef.current = false;
                    break;
                  case 'usage_update':
                    try { onUsageUpdateRef.current?.(); } catch {}
                    break;
                  case 'error':
                    setLastText('[error] ' + (maybe.message || ''));
                    setLastEvent({ type: 'error', text: maybe.message || '' });
                    break;
                  default:
                    break;
                }
              } else {
                // Legacy plain text fallback
                setLastText(data);
                setLastEvent({ type: 'raw', text: String(data) });
              }
            } else {
              setLastText(String(data));
              setLastEvent({ type: 'raw', text: String(data) });
            }
          } catch (err) {
            console.error('WS onmessage handler error:', err);
          }
        };

        ws.onclose = (ev: CloseEvent) => {
          console.warn('WS closed', { code: ev.code, reason: ev.reason, wasClean: (ev as any).wasClean });
          if (shuttingDownRef.current) return;
          setStatus('disconnected');
          scheduleReconnect();
        };
        ws.onerror = (ev: Event) => {
          console.error('WS error', ev);
          if (shuttingDownRef.current) return;
          setStatus('disconnected');
          scheduleReconnect();
        };
      } catch (e) {
        if (!shuttingDownRef.current) {
          setStatus('disconnected');
          scheduleReconnect();
        }
      }
    };

    const scheduleReconnect = () => {
      const attempt = ++reconnectAttemptsRef.current;
      const base = Math.min(30000, 1000 * Math.pow(2, attempt)); // cap 30s
      const jitter = Math.floor(Math.random() * 500);
      const delay = base + jitter;
      setTimeout(() => { if (!shuttingDownRef.current) connect(); }, delay);
    };

    connect();

    return () => {
      shuttingDownRef.current = true;
      try { socketRef.current?.close(); } catch {}
      socketRef.current = null;
      setStatus('disconnected');
  // Reset stream state
  streamOpenRef.current = false;
  currentStreamFenceRef.current = -1;
    };
  }, [urlBase, conversationId]);

  const sendAudioChunk = (chunk: ArrayBuffer) => {
    const ws = socketRef.current;
    if (!ws || ws.readyState !== WebSocket.OPEN) return false;
    try {
      ws.send(chunk);
      return true;
    } catch (e) {
      console.error('Failed to send chunk:', e);
      return false;
    }
  };

  const endUtterance = () => {
    const ws = socketRef.current;
    if (!ws || ws.readyState !== WebSocket.OPEN) return false;
    try {
      ws.send(JSON.stringify({ type: 'utterance_end' }));
      return true;
    } catch (e) {
      console.error('Failed to signal end of utterance:', e);
      return false;
    }
  };

  // Immediately stop audio and ignore any late packets for the in-flight stream
  const halt = () => {
  const now = Date.now();
  // Ignore rapid re-halts or late audio_end cascades within 300ms
  if (now - haltedAtRef.current < 300) return;
  haltedAtRef.current = now;
    // Advance the accept fence to invalidate any current stream.
    acceptFenceRef.current += 1;
    // Close any open stream locally and notify consumer to end playback.
    if (streamOpenRef.current) {
      streamOpenRef.current = false;
      try { onAudioEndRef.current?.(); } catch {}
    }
  };

  const disconnect = () => {
    try {
      shuttingDownRef.current = true;
      try { socketRef.current?.close(); } catch {}
      socketRef.current = null;
      setStatus('disconnected');
      // Reset stream state
      streamOpenRef.current = false;
      currentStreamFenceRef.current = -1;
    } catch {}
  };

  return { connectionStatus: status, sendAudioChunk, endUtterance, lastText, lastEvent, halt, disconnect } as const;
}

function safeParse<T>(s: string): T | null {
  try { return JSON.parse(s) as T; } catch { return null; }
}
