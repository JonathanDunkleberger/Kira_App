// Client-side WebSocket connection manager for voice streaming
// Establishes a WS connection, plays incoming binary audio with playAudioData,
// and exposes a sendAudioChunk method for outgoing audio frames.

import { useEffect, useRef, useState } from 'react';
import { playAudioData } from '@/lib/audio';

export type SocketStatus = 'connecting' | 'connected' | 'disconnected';

export function useVoiceSocket(url: string = 'ws://localhost:8080') {
  const socketRef = useRef<WebSocket | null>(null);
  const [status, setStatus] = useState<SocketStatus>('connecting');
  const [lastText, setLastText] = useState<string>('');

  useEffect(() => {
    let closed = false;
    try {
      const ws = new WebSocket(url);
      socketRef.current = ws;

      ws.binaryType = 'arraybuffer';

      ws.onopen = () => {
        if (closed) return;
        setStatus('connected');
      };

      ws.onmessage = async (event: MessageEvent) => {
        if (closed) return;
        const data = event.data;
        try {
          if (data instanceof ArrayBuffer) {
            // Incoming TTS audio as binary
            await playAudioData(data);
          } else if (data instanceof Blob) {
            const ab = await data.arrayBuffer();
            await playAudioData(ab);
          } else if (typeof data === 'string') {
            setLastText(data);
          } else {
            // Fallback: try to stringify
            setLastText(String(data));
          }
        } catch (err) {
          console.error('WS onmessage handler error:', err);
        }
      };

      ws.onclose = () => {
        if (closed) return;
        setStatus('disconnected');
      };

      ws.onerror = (err) => {
        console.error('WS error:', err);
      };

      return () => {
        closed = true;
        try { ws.close(); } catch {}
        socketRef.current = null;
        setStatus('disconnected');
      };
    } catch (e) {
      console.error('Failed to open WS:', e);
      setStatus('disconnected');
    }
  }, [url]);

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

  return { status, sendAudioChunk } as const;
}
