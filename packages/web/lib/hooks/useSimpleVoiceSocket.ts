// lib/hooks/useSimpleVoiceSocket.ts
'use client';
import { useEffect, useRef } from 'react';
import { envClient } from '@/lib/client/env.client';
import { useConversationStore } from '@/lib/state/conversation-store';

export const useSimpleVoiceSocket = () => {
  const wsRef = useRef<WebSocket | null>(null);
  const { setStatus, addMessage, setWsConnection } = useConversationStore();
  const timerStartedRef = useRef(false);
  const firstTextLoggedRef = useRef(false);

  useEffect(() => {
    const connectWebSocket = () => {
      const url = envClient.NEXT_PUBLIC_WEBSOCKET_URL;
      const ws = new WebSocket(url);
      ws.binaryType = 'arraybuffer';

      ws.onopen = () => {
        setWsConnection(ws);
        wsRef.current = ws;
        try {
          ws.send(JSON.stringify({ type: 'client_ready' }));
        } catch {}
      };

      ws.onmessage = (event) => {
        try {
          // Text events from server; binary (audio) handled elsewhere
          const data = JSON.parse(event.data);
          switch (data.type) {
            case 'server_ack':
              setStatus('listening');
              break;
            case 'user_transcript':
              addMessage({ role: 'user', content: data.text });
              setStatus('processing');
              break;
            case 'assistant_message':
              addMessage({ role: 'assistant', content: data.text });
              if (!firstTextLoggedRef.current) {
                try { console.timeLog('full-response-latency', 'First text chunk received'); } catch {}
                firstTextLoggedRef.current = true;
              }
              break;
            case 'assistant_speaking_start':
              setStatus('speaking');
              break;
            case 'assistant_speaking_end':
              setStatus('listening');
              try { console.timeEnd('full-response-latency'); } catch {}
              timerStartedRef.current = false;
              firstTextLoggedRef.current = false;
              break;
            case 'limit_exceeded':
              setStatus('idle');
              break;
          }
        } catch (error) {
          // Binary or non-JSON data ignored in this simple hook
        }
      };

      ws.onclose = () => {
        setStatus('idle');
      };
    };

    connectWebSocket();

    return () => {
      if (wsRef.current) {
        wsRef.current.close();
      }
    };
  }, [addMessage, setStatus, setWsConnection]);

  const sendAudio = (audioData: ArrayBuffer) => {
    if (!timerStartedRef.current) {
      try {
        console.time('full-response-latency');
      } catch {}
      timerStartedRef.current = true;
      firstTextLoggedRef.current = false;
    }
    if (wsRef.current?.readyState === WebSocket.OPEN) {
      wsRef.current.send(audioData);
    }
  };

  return { sendAudio };
};
