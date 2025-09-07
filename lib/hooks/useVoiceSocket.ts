// In lib/hooks/useVoiceSocket.ts

import { useEffect, useRef, useState, useCallback } from 'react';
import { preferredTtsFormat } from '@/lib/audio';
import { supabase } from '@/lib/client/supabaseClient';

export type SocketStatus = 'connecting' | 'connected' | 'disconnected';

const WSS_URL = process.env.NEXT_PUBLIC_WEBSOCKET_URL_PROD || process.env.NEXT_PUBLIC_WEBSOCKET_URL;

export function useVoiceSocket(onMessageOrOpts: ((msg: any) => void) | { onMessage: (msg: any) => void; conversationId?: string | null }) {
  const socketRef = useRef<WebSocket | null>(null);
  const [status, setStatus] = useState<SocketStatus>('disconnected');
  const onMessageRef = useRef<(msg: any) => void>(typeof onMessageOrOpts === 'function' ? onMessageOrOpts : onMessageOrOpts.onMessage);
  const convIdRef = useRef<string | null>(typeof onMessageOrOpts === 'function' ? null : (onMessageOrOpts.conversationId ?? null));

  useEffect(() => {
    if (typeof onMessageOrOpts === 'function') {
      onMessageRef.current = onMessageOrOpts;
    } else {
      onMessageRef.current = onMessageOrOpts.onMessage;
      convIdRef.current = onMessageOrOpts.conversationId ?? null;
    }
  }, [onMessageOrOpts]);

  const connect = useCallback(async () => {
    if (socketRef.current || !WSS_URL) return;
    if (!convIdRef.current) return; // require conversationId in hybrid mode

    console.log('[WS] Attempting to connect...');
    // Attach token and tts preference in the URL for server-side auth/format
    let url = WSS_URL;
    try {
      const u = new URL(WSS_URL);
      // conversationId
      try { if (convIdRef.current) u.searchParams.set('conversationId', convIdRef.current); } catch {}
      // token
      try {
        const { data } = await supabase.auth.getSession();
        const token = data?.session?.access_token || '';
        if (token) u.searchParams.set('token', token);
      } catch {}
      // tts format
      try {
        const pref = preferredTtsFormat();
        if (pref?.fmt) u.searchParams.set('tts', pref.fmt);
      } catch {}
      url = u.toString();
    } catch {}

    const ws = new WebSocket(url);
    socketRef.current = ws;
    setStatus('connecting');
    ws.binaryType = 'arraybuffer';

    ws.onopen = () => {
      if (process.env.NODE_ENV !== 'production') console.log('[WS] Connection opened.');
      setStatus('connected');
    };

    ws.onclose = () => {
      if (process.env.NODE_ENV !== 'production') console.warn('[WS] Connection closed. Reconnecting in 5s...');
      socketRef.current = null;
      setStatus('disconnected');
      setTimeout(() => { void connect(); }, 5000);
    };

    ws.onerror = (err) => {
      if (process.env.NODE_ENV !== 'production') console.error('[WS] WebSocket error:', err);
      ws.close(); // This will trigger the onclose handler for reconnect logic
    };

    ws.onmessage = (event) => {
      // Pass all messages, binary or text, to the provider for handling
      if (typeof event.data === 'string') {
        if (process.env.NODE_ENV !== 'production') {
          try {
            const parsed = JSON.parse(event.data);
            console.log('[WS] Received STRING:', parsed);
          } catch {
            console.log('[WS] Received STRING (raw):', event.data);
          }
        }
        try {
          const msg = JSON.parse(event.data);
          onMessageRef.current(msg);
        } catch (e) {
          if (process.env.NODE_ENV !== 'production') console.error('Failed to parse server JSON message:', e);
        }
      } else {
        // BINARY (ArrayBuffer due to binaryType = 'arraybuffer')
        if (process.env.NODE_ENV !== 'production') {
          try {
            const size = (event.data as ArrayBuffer)?.byteLength ?? 0;
            console.log('[WS] Received BINARY (ArrayBuffer). Size:', size, 'bytes');
          } catch {}
        }
        onMessageRef.current(event.data);
      }
    };
  }, []);

  const send = useCallback((data: object | ArrayBuffer) => {
    if (socketRef.current?.readyState === WebSocket.OPEN) {
      if (data instanceof ArrayBuffer) {
        if (process.env.NODE_ENV !== 'production') {
          try { console.log('[WS] Sending BINARY. Size:', (data as ArrayBuffer).byteLength, 'bytes'); } catch {}
        }
        socketRef.current.send(data);
      } else {
        if (process.env.NODE_ENV !== 'production') {
          try { console.log('[WS] Sending STRING:', data); } catch {}
        }
        socketRef.current.send(JSON.stringify(data));
      }
    } else {
      if (process.env.NODE_ENV !== 'production') console.warn('[WS] Send failed: WebSocket not open.');
    }
  }, []);

  const disconnect = useCallback(() => {
    try { socketRef.current?.close(); } catch {}
    socketRef.current = null;
    setStatus('disconnected');
  }, []);

  useEffect(() => {
    // reconnect when conversationId changes
    try { socketRef.current?.close(); } catch {}
    socketRef.current = null;
    setStatus('disconnected');
    void connect();
    return () => { try { socketRef.current?.close(); } catch {}; };
  }, [connect, (typeof onMessageOrOpts === 'function') ? null : onMessageOrOpts.conversationId]);

  return { status, send, disconnect } as const;
}
