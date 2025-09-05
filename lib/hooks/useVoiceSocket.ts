// Client-side WebSocket connection manager for voice streaming
// Establishes a WS connection and forwards audio frames via callbacks.

import { useEffect, useRef, useState } from 'react';
import { preferredTtsFormat } from '@/lib/audio';

export type SocketStatus = 'connecting' | 'connected' | 'disconnected';

type ServerMsg =
  | { type: 'ready' }
  | { type: 'transcript'; text: string }
  | { type: 'assistant_text'; text: string }
  | { type: 'audio_start' }
  | { type: 'audio_end' }
  | { type: 'audio_format'; format: 'webm' | 'mp3' }
  | { type: 'usage_update'; secondsRemaining?: number }
  | { type: 'error'; message: string };

type VoiceSocketOptions = {
  url?: string;
  onAudioChunk?: (chunk: ArrayBuffer) => void;
  onAudioStart?: () => void;
  onAudioEnd?: () => void;
  onAudioFormat?: (format: 'webm' | 'mp3') => void;
  onTranscript?: (text: string) => void;
  onAssistantText?: (text: string) => void;
  onUsageUpdate?: (secondsRemaining?: number) => void;
  conversationId?: string | null;
};

type LastEvent = { type: 'transcript' | 'assistant_text' | 'error' | 'raw'; text: string };

const WSS_URL = process.env.NODE_ENV === 'production'
  ? process.env.NEXT_PUBLIC_WEBSOCKET_URL_PROD
  : process.env.NEXT_PUBLIC_WEBSOCKET_URL;

export function useVoiceSocket(opts: VoiceSocketOptions) {
  const socketRef = useRef<WebSocket | null>(null);
  const [status, setStatus] = useState<SocketStatus>('disconnected');
  const [lastText, setLastText] = useState<string>('');
  const [lastEvent, setLastEvent] = useState<LastEvent | null>(null);

  // Avoid stale closures by mirroring options and conversationId in refs
  const optionsRef = useRef(opts);
  const reconnectAttemptsRef = useRef(0);
  const shuttingDownRef = useRef(false);
  useEffect(() => {
    optionsRef.current = opts;
  }, [opts]);

  // Audio stream fencing so late packets are ignored after halt
  const acceptFenceRef = useRef(0);
  const currentStreamFenceRef = useRef(-1);
  const streamOpenRef = useRef(false);

  useEffect(() => {
    const { conversationId } = optionsRef.current;
    // If there's no conversation ID, ensure we are disconnected.
    if (!conversationId) {
      if (socketRef.current) {
        shuttingDownRef.current = true;
        try { socketRef.current.close(); } catch {}
        socketRef.current = null;
      }
      setStatus('disconnected');
      return;
    }

    shuttingDownRef.current = false;

    const connect = async () => {
      const currentOpts = optionsRef.current;
      const urlBase = currentOpts.url || WSS_URL || '';
      const currentConversationId = currentOpts.conversationId;
      if (!urlBase || !currentConversationId) { setStatus('disconnected'); return; }

      let token = '';
      try {
        const { supabase } = await import('@/lib/client/supabaseClient');
        const { data } = await (supabase as any).auth.getSession();
        token = data?.session?.access_token || '';
      } catch {}

      let cid = '';
      try {
        if (typeof window !== 'undefined') {
          cid = localStorage.getItem('kira_cid') || (crypto?.randomUUID?.() || `${Date.now()}-${Math.random()}`);
          localStorage.setItem('kira_cid', cid);
        }
      } catch {}

      const url = new URL(urlBase);
      if (token) url.searchParams.set('token', token);
      url.searchParams.set('conversationId', currentConversationId!);
      if (cid) url.searchParams.set('cid', cid);
      try {
        const pref = preferredTtsFormat();
        url.searchParams.set('tts', pref.fmt);
      } catch {}

      try {
        const ws = new WebSocket(url.toString());
        socketRef.current = ws;
        ws.binaryType = 'arraybuffer';
        setStatus('connecting');

        ws.onopen = () => {
          reconnectAttemptsRef.current = 0;
          if (!shuttingDownRef.current) setStatus('connected');
        };

        ws.onmessage = (ev: MessageEvent) => {
          const latest = optionsRef.current;
          if (shuttingDownRef.current || typeof latest === 'string') return;
          const d = ev.data;
          try {
            if (d instanceof ArrayBuffer) {
              if (streamOpenRef.current && currentStreamFenceRef.current === acceptFenceRef.current) {
                latest.onAudioChunk?.(d);
              }
              return;
            }
            const maybe = safeParse<ServerMsg>(d as string);
            if (!maybe) { setLastEvent({ type: 'raw', text: String(d) }); return; }
            switch (maybe.type) {
              case 'audio_start':
                currentStreamFenceRef.current = acceptFenceRef.current;
                streamOpenRef.current = true;
                latest.onAudioStart?.();
                break;
              case 'audio_end':
                if (streamOpenRef.current && currentStreamFenceRef.current === acceptFenceRef.current) {
                  latest.onAudioEnd?.();
                }
                streamOpenRef.current = false;
                break;
              case 'audio_format':
                latest.onAudioFormat?.(maybe.format);
                break;
              case 'transcript':
                setLastText(maybe.text); setLastEvent({ type: 'transcript', text: maybe.text || '' });
                latest.onTranscript?.(maybe.text);
                break;
              case 'assistant_text':
                setLastText(maybe.text); setLastEvent({ type: 'assistant_text', text: maybe.text || '' });
                latest.onAssistantText?.(maybe.text);
                break;
              case 'usage_update':
                latest.onUsageUpdate?.(maybe.secondsRemaining);
                break;
              case 'error':
                setLastText('[error] ' + (maybe.message || '')); setLastEvent({ type: 'error', text: maybe.message || '' });
                break;
              case 'ready':
                // no-op
                break;
            }
          } catch (e) { console.error('[ws] message error', e); }
        };

        const scheduleReconnect = () => {
          if (shuttingDownRef.current) return;
          setStatus('disconnected');
          const attempt = ++reconnectAttemptsRef.current;
          const delay = Math.min(10_000, 500 * 2 ** attempt);
          setTimeout(() => { if (!shuttingDownRef.current) connect(); }, delay);
        };

        ws.onclose = scheduleReconnect;
        ws.onerror = scheduleReconnect;
      } catch {
        if (!shuttingDownRef.current) {
          setStatus('disconnected');
          const attempt = ++reconnectAttemptsRef.current;
          const delay = Math.min(10_000, 500 * 2 ** attempt);
          setTimeout(() => { if (!shuttingDownRef.current) connect(); }, delay);
        }
      }
    };

    connect();
    return () => {
      shuttingDownRef.current = true;
      try { socketRef.current?.close(); } catch {}
      socketRef.current = null;
      setStatus('disconnected');
      streamOpenRef.current = false;
      currentStreamFenceRef.current = -1;
    };
  }, [opts.conversationId]);

  const sendAudioChunk = (chunk: ArrayBuffer) => {
    const ws = socketRef.current;
    if (!ws || ws.readyState !== WebSocket.OPEN) return false;
    try { ws.send(chunk); return true; } catch { return false; }
  };

  const endUtterance = () => {
    const ws = socketRef.current;
    if (!ws || ws.readyState !== WebSocket.OPEN) return false;
    try { ws.send(JSON.stringify({ type: 'end_utterance' })); return true; } catch { return false; }
  };

  // Immediately stop audio and ignore any late packets for the in-flight stream
  const halt = () => {
    acceptFenceRef.current += 1;
    const ws = socketRef.current;
    if (ws && ws.readyState === WebSocket.OPEN) {
      try { ws.send(JSON.stringify({ type: 'halt' })); } catch {}
    }
    // Locally mark the stream closed so UI can stop playback promptly
    if (streamOpenRef.current) {
      streamOpenRef.current = false;
    }
  };

  const disconnect = () => {
    try {
      shuttingDownRef.current = true;
      try { socketRef.current?.close(); } catch {}
      socketRef.current = null;
      setStatus('disconnected');
      streamOpenRef.current = false;
      currentStreamFenceRef.current = -1;
    } catch {}
  };

  return { connectionStatus: status, sendAudioChunk, endUtterance, lastText, lastEvent, halt, disconnect } as const;
}

function safeParse<T>(s: string): T | null { try { return JSON.parse(s) as T; } catch { return null; } }
