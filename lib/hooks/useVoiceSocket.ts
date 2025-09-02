// Client-side WebSocket connection manager for voice streaming
// Establishes a WS connection, buffers audio frames between audio_start/audio_end,
// and exposes sendAudioChunk and endUtterance controls.

import { useEffect, useRef, useState } from 'react';
import { playAudioData } from '@/lib/audio';

export type SocketStatus = 'connecting' | 'connected' | 'disconnected';

type ServerMsg =
  | { type: 'ready' }
  | { type: 'transcript'; text: string }
  | { type: 'assistant_text'; text: string }
  | { type: 'audio_start' }
  | { type: 'audio_end' }
  | { type: 'error'; message: string };

export function useVoiceSocket(urlBase: string = 'ws://localhost:8080') {
  const socketRef = useRef<WebSocket | null>(null);
  const [status, setStatus] = useState<SocketStatus>('connecting');
  const [lastText, setLastText] = useState<string>('');
  const audioBuffersRef = useRef<Uint8Array[]>([]);
  const playingRef = useRef<Promise<void> | null>(null);
  const reconnectAttemptsRef = useRef(0);
  const shuttingDownRef = useRef(false);

  useEffect(() => {
    shuttingDownRef.current = false;

    const connect = async () => {
      // Add auth token if available via Supabase client
      let token = '';
      try {
        const { supabase } = await import('@/lib/supabaseClient');
        const { data } = await (supabase as any).auth.getSession();
        token = data?.session?.access_token || '';
      } catch {}

      const url = new URL(urlBase);
      if (token) url.searchParams.set('token', token);

      try {
        const ws = new WebSocket(url.toString());
        socketRef.current = ws;
        ws.binaryType = 'arraybuffer';
        setStatus('connecting');

        ws.onopen = () => {
          reconnectAttemptsRef.current = 0;
          if (!shuttingDownRef.current) setStatus('connected');
        };

        ws.onmessage = async (event: MessageEvent) => {
          if (shuttingDownRef.current) return;
          const data = event.data;
          try {
            if (data instanceof ArrayBuffer) {
              // Accumulate between audio_start/audio_end
              audioBuffersRef.current.push(new Uint8Array(data));
            } else if (data instanceof Blob) {
              const ab = await data.arrayBuffer();
              audioBuffersRef.current.push(new Uint8Array(ab));
            } else if (typeof data === 'string') {
              const maybe = safeParse<ServerMsg>(data);
              if (maybe) {
                switch (maybe.type) {
                  case 'transcript':
                    setLastText(maybe.text);
                    break;
                  case 'assistant_text':
                    setLastText(maybe.text);
                    break;
                  case 'audio_start':
                    audioBuffersRef.current = [];
                    break;
                  case 'audio_end':
                    if (audioBuffersRef.current.length) {
                      const totalLen = audioBuffersRef.current.reduce((n, b) => n + b.byteLength, 0);
                      const merged = new Uint8Array(totalLen);
                      let offset = 0;
                      for (const part of audioBuffersRef.current) { merged.set(part, offset); offset += part.byteLength; }
                      const { done } = playAudioData(merged.buffer);
                      playingRef.current = done;
                      await done; // ensure serial playback
                      playingRef.current = null;
                    }
                    break;
                  case 'error':
                    setLastText('[error] ' + (maybe.message || ''));
                    break;
                  default:
                    break;
                }
              } else {
                // Legacy plain text fallback
                setLastText(data);
              }
            } else {
              setLastText(String(data));
            }
          } catch (err) {
            console.error('WS onmessage handler error:', err);
          }
        };

        ws.onclose = () => {
          if (shuttingDownRef.current) return;
          setStatus('disconnected');
          scheduleReconnect();
        };
        ws.onerror = () => {
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
    };
  }, [urlBase]);

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

  return { connectionStatus: status, sendAudioChunk, endUtterance, lastText } as const;
}

function safeParse<T>(s: string): T | null {
  try { return JSON.parse(s) as T; } catch { return null; }
}
