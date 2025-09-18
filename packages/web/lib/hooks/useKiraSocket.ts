'use client';
import { useEffect, useRef, useState, useCallback } from 'react';
import { useConversationStore } from '@/lib/state/conversation-store';

type SocketStatus = 'connecting' | 'connected' | 'disconnected';

export function useKiraSocket(conversationId: string | null) {
  const wsRef = useRef<WebSocket | null>(null);
  const mediaRecorderRef = useRef<MediaRecorder | null>(null);
  const mediaSourceRef = useRef<MediaSource | null>(null);
  const sourceBufferRef = useRef<SourceBuffer | null>(null);
  const audioQueue = useRef<ArrayBuffer[]>([]);
  const [status, setStatus] = useState<SocketStatus>('disconnected');
  const { addMessage, setSpeaking } = useConversationStore();

  const playFromQueue = useCallback(() => {
    if (!sourceBufferRef.current || sourceBufferRef.current.updating || audioQueue.current.length === 0) {
      return;
    }
    const chunk = audioQueue.current.shift();
    if (chunk) {
      try {
        sourceBufferRef.current.appendBuffer(chunk);
      } catch (e) {
        console.error("Error appending audio buffer:", e);
      }
    }
  }, []);
  
  const setupAudioPlayback = useCallback(() => {
    const audioEl = document.getElementById('tts-audio') as HTMLAudioElement;
    if (!audioEl || mediaSourceRef.current) return;
    
    const ms = new MediaSource();
    mediaSourceRef.current = ms;
    audioEl.src = URL.createObjectURL(ms);
    
    const onSourceOpen = () => {
      if (MediaSource.isTypeSupported('audio/webm; codecs=opus')) {
        const sb = ms.addSourceBuffer('audio/webm; codecs=opus');
        sb.addEventListener('updateend', playFromQueue);
        sourceBufferRef.current = sb;
      } else {
        console.error('Unsupported MIME type for MediaSource');
      }
    };
    
    ms.addEventListener('sourceopen', onSourceOpen);
    return () => ms.removeEventListener('sourceopen', onSourceOpen);
  }, [playFromQueue]);

  const connect = useCallback(() => {
    if (wsRef.current || !conversationId) return;

    const url = new URL(process.env.NEXT_PUBLIC_WEBSOCKET_URL!);
    url.searchParams.set('conversationId', conversationId);

    setStatus('connecting');
    const ws = new WebSocket(url);
    wsRef.current = ws;

    ws.onopen = () => setStatus('connected');
    ws.onerror = (err) => console.error('[WS] Error:', err);
    ws.onclose = () => {
      setStatus('disconnected');
      wsRef.current = null;
    };

    ws.onmessage = (event) => {
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
        case 'tts_start': {
          const audioEl = document.getElementById('tts-audio') as HTMLAudioElement | null;
          audioEl?.play().catch(() => {});
          break;
        }
        case 'tts_chunk':
          const audioChunk = Uint8Array.from(atob(msg.b64), c => c.charCodeAt(0)).buffer;
          audioQueue.current.push(audioChunk);
          playFromQueue();
          break;
        case 'tts_end':
          const checkBuffer = () => {
              if (sourceBufferRef.current && !sourceBufferRef.current.updating) {
                  mediaSourceRef.current?.endOfStream();
              } else {
                  setTimeout(checkBuffer, 100);
              }
          };
          checkBuffer();
          break;
      }
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
    if (!mediaRecorderRef.current) return;
    mediaRecorderRef.current.stop();
    mediaRecorderRef.current.stream.getTracks().forEach(track => track.stop());
    mediaRecorderRef.current = null;
  }, []);

  useEffect(() => {
    const cleanup = setupAudioPlayback();
    connect();
    return () => {
      wsRef.current?.close();
      stopMic();
      if (cleanup) cleanup();
    };
  }, [connect, stopMic, setupAudioPlayback]);

  return { status, startMic, stopMic };
}
