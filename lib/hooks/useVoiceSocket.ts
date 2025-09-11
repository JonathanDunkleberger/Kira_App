// In lib/hooks/useVoiceSocket.ts

import { useEffect, useRef, useState, useCallback } from 'react';

import { preferredTtsFormat } from '../audio';
import { useUsage } from '../useUsage';

export type SocketStatus = 'connecting' | 'connected' | 'disconnected';

// Resolve base WS URL from environment; provide a dev fallback when not set
const WS_BASE =
  process.env.NEXT_PUBLIC_WEBSOCKET_URL_PROD ||
  process.env.NEXT_PUBLIC_WEBSOCKET_URL ||
  (process.env.NODE_ENV !== 'production' ? 'ws://localhost:10000' : undefined);

export function useVoiceSocket(
  onMessageOrOpts:
    | ((msg: any) => void)
    | { onMessage: (msg: any) => void; conversationId?: string | null },
) {
  const socketRef = useRef<WebSocket | null>(null);
  const [status, setStatus] = useState<SocketStatus>('disconnected');
  const onMessageRef = useRef<(msg: any) => void>(
    typeof onMessageOrOpts === 'function' ? onMessageOrOpts : onMessageOrOpts.onMessage,
  );
  const convIdRef = useRef<string | null>(
    typeof onMessageOrOpts === 'function' ? null : (onMessageOrOpts.conversationId ?? null),
  );
  // Timing instrumentation
  const timerStartedRef = useRef(false);
  const firstTextLoggedRef = useRef(false);

  useEffect(() => {
    if (typeof onMessageOrOpts === 'function') {
      onMessageRef.current = onMessageOrOpts;
    } else {
      onMessageRef.current = onMessageOrOpts.onMessage;
      convIdRef.current = onMessageOrOpts.conversationId ?? null;
    }
  }, [onMessageOrOpts]);

  const connect = useCallback(async () => {
    if (socketRef.current) return;
    if (!WS_BASE) {
      if (process.env.NODE_ENV !== 'production') {
        console.error('[WS] No WebSocket URL configured. Set NEXT_PUBLIC_WEBSOCKET_URL.');
      }
      return;
    }
    // Allow missing conversationId (server will auto-create if omitted)

    if (process.env.NODE_ENV !== 'production') {
      console.log('[WS] Attempting to connect...');
      console.log(`[WS] Connecting to WebSocket server at: ${WS_BASE}`);
    }
    // Attach token and tts preference in the URL for server-side auth/format
    let url = WS_BASE;
    try {
      const u = new URL(WS_BASE);
      // conversationId
      try {
        if (convIdRef.current) u.searchParams.set('conversationId', convIdRef.current);
      } catch {}
      // token
  // Clerk cookie auth: no bearer token appended.
      // tts format
      try {
        const pref = preferredTtsFormat();
        if (pref?.fmt) u.searchParams.set('tts', pref.fmt);
      } catch {}
      url = u.toString();
      if (process.env.NODE_ENV !== 'production') {
        console.log('[WS] Final URL (with params):', url);
      }
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
      if (process.env.NODE_ENV !== 'production')
        console.warn('[WS] Connection closed. Reconnecting in 5s...');
      socketRef.current = null;
      setStatus('disconnected');
      setTimeout(() => {
        void connect();
      }, 5000);
    };

    ws.onerror = (err) => {
      if (process.env.NODE_ENV !== 'production') console.error('[WS] WebSocket error:', err);
      ws.close(); // This will trigger the onclose handler for reconnect logic
    };

    ws.onmessage = (event) => {
      // Pass all messages, binary or text, to the provider for handling
      if (typeof event.data === 'string') {
        try {
          const msg = JSON.parse(event.data);
          if (process.env.NODE_ENV !== 'production') {
            console.log('[WS] Received STRING:', msg);
          }
          // Timing checkpoints
          try {
            if (
              (msg.type === 'assistant_text' || msg.type === 'assistant_text_chunk') &&
              !firstTextLoggedRef.current
            ) {
              console.timeLog('full-response-latency', 'First text chunk received');
              firstTextLoggedRef.current = true;
            }
            if (msg.type === 'audio_start') {
              console.timeLog('full-response-latency', 'Audio started playing');
              console.timeEnd('full-response-latency');
              timerStartedRef.current = false;
              firstTextLoggedRef.current = false;
            }
          } catch {}
          if (msg?.t === 'heartbeat') {
            try {
              useUsage.getState().setHeartbeat(msg);
            } catch {}
            try {
              (window as any).__onHeartbeat?.(msg);
            } catch {}
          } else if (msg?.t === 'chat_session') {
            // capture new conversation id if server auto-created one
            if (!convIdRef.current && msg.chatSessionId) {
              convIdRef.current = msg.chatSessionId;
            }
          } else {
            onMessageRef.current(msg);
          }
        } catch (e) {
          if (process.env.NODE_ENV !== 'production')
            console.error('Failed to parse server JSON message:', e);
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
        // Start turn timing on first audio send
        if (!timerStartedRef.current) {
          try {
            console.time('full-response-latency');
          } catch {}
          timerStartedRef.current = true;
          firstTextLoggedRef.current = false;
        }
        if (process.env.NODE_ENV !== 'production') {
          try {
            console.log('[WS] Sending BINARY. Size:', (data as ArrayBuffer).byteLength, 'bytes');
          } catch {}
        }
        socketRef.current.send(data);
      } else {
        if (process.env.NODE_ENV !== 'production') {
          try {
            console.log('[WS] Sending STRING:', data);
          } catch {}
        }
        socketRef.current.send(JSON.stringify(data));
      }
    } else {
      if (process.env.NODE_ENV !== 'production')
        console.warn('[WS] Send failed: WebSocket not open.');
    }
  }, []);

  const disconnect = useCallback(() => {
    try {
      socketRef.current?.close();
    } catch {}
    socketRef.current = null;
    setStatus('disconnected');
  }, []);

  // derive current conversationId value for effect deps
  const conversationId =
    typeof onMessageOrOpts === 'function' ? null : (onMessageOrOpts.conversationId ?? null);

  useEffect(() => {
    // reconnect when conversationId changes
    try {
      socketRef.current?.close();
    } catch {}
    socketRef.current = null;
    setStatus('disconnected');
    void connect();
    return () => {
      try {
        socketRef.current?.close();
      } catch {}
    };
  }, [connect, conversationId]);

  // Start microphone capture + streaming via MediaRecorder
  const startMic = useCallback(
    async (audioConstraints?: MediaTrackConstraints) => {
      const stream = await navigator.mediaDevices.getUserMedia({
        audio: {
          echoCancellation: true,
          noiseSuppression: true,
          autoGainControl: true,
          ...audioConstraints,
        },
      });
      const mime = MediaRecorder.isTypeSupported('audio/webm;codecs=opus')
        ? 'audio/webm;codecs=opus'
        : 'audio/webm';
      const rec = new MediaRecorder(stream, { mimeType: mime, audioBitsPerSecond: 48000 });
      rec.ondataavailable = (e) => {
        if (e.data?.size) {
          try {
            e.data.arrayBuffer().then((buf) => send(buf));
          } catch {}
        }
      };
      rec.start(250);
      return () => {
        try {
          rec.stop();
        } catch {}
        stream.getTracks().forEach((t) => t.stop());
      };
    },
    [send],
  );

  const signal = useCallback(
    (type: string, payload?: any) => {
      try {
        send({ t: type, ...(payload || {}) });
      } catch {}
    },
    [send],
  );

  return { status, send, disconnect, connect, startMic, signal } as const;
}
