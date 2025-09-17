'use client';
import { useEffect, useRef, useState, useCallback } from 'react';
// Placeholder store hooks; adjust to actual implementation if differs
import { useConversationStore } from '@/lib/state/conversation-store';

type SocketStatus = 'connecting' | 'connected' | 'disconnected';

export function useKiraSocket(conversationId: string | null) {
  const wsRef = useRef<WebSocket | null>(null);
  const mediaRecorderRef = useRef<MediaRecorder | null>(null);
  const mediaSourceRef = useRef<MediaSource | null>(null);
  const sourceBufferRef = useRef<SourceBuffer | null>(null);
  const audioQueue = useRef<ArrayBuffer[]>([]);
  const [status, setStatus] = useState<SocketStatus>('disconnected');
  const { addMessage, setSpeaking, clearMessages } = useConversationStore();

  const playFromQueue = useCallback(() => {
    if (!sourceBufferRef.current || sourceBufferRef.current.updating || audioQueue.current.length === 0) {
      return;
    }
    const chunk = audioQueue.current.shift();
    if (chunk) {
      try {
        sourceBufferRef.current.appendBuffer(chunk);
      } catch (e) {
        console.error('Error appending buffer:', e);
      }
    }
  }, []);

  const setupAudioPlayback = useCallback(() => {
    const audioEl = document.getElementById('tts-audio') as HTMLAudioElement | null;
    if (!audioEl || mediaSourceRef.current) return;

    const ms = new MediaSource();
    mediaSourceRef.current = ms;
    audioEl.src = URL.createObjectURL(ms);
    audioEl.play().catch(e => console.warn('Audio play requires user interaction.', e));

    ms.addEventListener('sourceopen', () => {
      if (MediaSource.isTypeSupported('audio/webm; codecs=opus')) {
        sourceBufferRef.current = ms.addSourceBuffer('audio/webm; codecs=opus');
        sourceBufferRef.current.addEventListener('updateend', playFromQueue);
      } else {
        console.error('Unsupported MIME type for MediaSource');
      }
    });
  }, [playFromQueue]);

  const connect = useCallback(() => {
    if (wsRef.current || !conversationId) return;
    const baseUrl = process.env.NEXT_PUBLIC_WEBSOCKET_URL;
    if (!baseUrl) {
      console.error('Missing NEXT_PUBLIC_WEBSOCKET_URL');
      return;
    }
    const url = new URL(baseUrl);
    url.searchParams.set('conversationId', conversationId);

    console.log(`[WS] Connecting to ${url.toString()}`);
    setStatus('connecting');
    const ws = new WebSocket(url);
    wsRef.current = ws;

    ws.onopen = () => {
      setStatus('connected');
    };

    ws.onmessage = (event) => {
      try {
        const msg = JSON.parse(event.data);
        switch (msg.t) {
          case 'transcript':
            addMessage({ role: 'user', content: msg.text });
            break;
          case 'assistant_text_chunk':
            addMessage({ role: 'assistant', content: msg.text, isPartial: true });
            break;
          case 'speak':
            setSpeaking(msg.on);
            break;
          case 'tts_chunk': {
            const audioChunk = Uint8Array.from(atob(msg.b64), c => c.charCodeAt(0)).buffer;
            audioQueue.current.push(audioChunk);
            playFromQueue();
            break; }
          case 'tts_end':
            // no-op marker
            break;
        }
      } catch (e) {
        // ignore non-JSON
      }
    };

    ws.onerror = (err) => console.error('[WS] Error:', err);
    ws.onclose = () => {
      setStatus('disconnected');
      wsRef.current = null;
    };
  }, [conversationId, addMessage, setSpeaking, playFromQueue]);

  const startMic = useCallback(async () => {
    if (mediaRecorderRef.current) return;
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: true, noiseSuppression: true } });
      const recorder = new MediaRecorder(stream, { mimeType: 'audio/webm; codecs=opus' });
      mediaRecorderRef.current = recorder;
      recorder.ondataavailable = (event) => {
        if (event.data.size > 0 && wsRef.current?.readyState === WebSocket.OPEN) {
          wsRef.current.send(event.data);
        }
      };
      recorder.start(250);
    } catch (error) {
      console.error('Error starting microphone:', error);
    }
  }, []);

  const stopMic = useCallback(() => {
    mediaRecorderRef.current?.stop();
    mediaRecorderRef.current?.stream.getTracks().forEach(track => track.stop());
    mediaRecorderRef.current = null;
  }, []);

  useEffect(() => {
    setupAudioPlayback();
    connect();
    return () => {
      wsRef.current?.close();
      stopMic();
    };
  }, [connect, stopMic, setupAudioPlayback]);

  return { status, startMic, stopMic, clearMessages };
}
