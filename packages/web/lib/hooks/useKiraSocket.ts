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
    if (
      !sourceBufferRef.current ||
      sourceBufferRef.current.updating ||
      audioQueue.current.length === 0
    ) {
      return;
    }
    const chunk = audioQueue.current.shift();
    if (chunk) {
      try {
        sourceBufferRef.current.appendBuffer(chunk);
      } catch (e) {
        console.error('Error appending audio buffer:', e);
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
    if (wsRef.current) return;
    const url = new URL(process.env.NEXT_PUBLIC_WEBSOCKET_URL!);
    if (conversationId) url.searchParams.set('conversationId', conversationId);
    setStatus('connecting');
    const ws = new WebSocket(url.toString());
    wsRef.current = ws;

    ws.onopen = () => setStatus('connected');
    ws.onerror = (err) => console.error('[WS] Error:', err);
    ws.onclose = () => {
      setStatus('disconnected');
      wsRef.current = null;
      // simple backoff reconnect
      let attempt = 0;
      const retry = () => {
        if (wsRef.current) return; // already reconnected
        const delay = Math.min(8000, 500 * 2 ** attempt++);
        setTimeout(() => connect(), delay);
      };
      retry();
    };

    ws.onmessage = (event) => {
      const msg = JSON.parse(event.data);
      switch (msg.t) {
        case 'tts_start': {
          // Lazily create MediaSource pipeline on first audio
          setupAudioPlayback();
          const el = document.getElementById('tts-audio') as HTMLAudioElement | null;
          if (el) {
            el.muted = false; // reliable cross-browser
            el.play?.().catch(() => {}); // autoplay policy guard
          }
          break;
        }
        case 'transcript':
          addMessage({ role: 'user', content: msg.text });
          break;
        case 'assistant_text_chunk':
          addMessage({ role: 'assistant', content: msg.text, isPartial: true });
          break;
        case 'speak':
          setSpeaking(msg.on);
          break;
        case 'tts_chunk':
          const audioChunk = Uint8Array.from(atob(msg.b64), (c) => c.charCodeAt(0)).buffer;
          audioQueue.current.push(audioChunk);
          playFromQueue();
          break;
        case 'tts_end': {
          // Attempt to finalize the MediaSource stream safely.
          const ms = mediaSourceRef.current;
          if (!ms) break; // Nothing to finalize.

            // Drain any remaining queued chunks first.
          playFromQueue();

          const finalize = () => {
            if (!mediaSourceRef.current) return;
            try {
              mediaSourceRef.current.endOfStream();
            } catch (e) {
              console.warn('[TTS] endOfStream() failed (will ignore):', e);
            }
          };

          const sb = sourceBufferRef.current;
          // If no SourceBuffer ever created, try to end immediately.
          if (!sb) {
            finalize();
            break;
          }

          // Wait until SourceBuffer not updating AND local queue drained.
          const tryClose = (attempt = 0) => {
            // Keep nudging playback of any leftover queued chunks.
            playFromQueue();
            if (!sourceBufferRef.current) {
              finalize();
              return;
            }
            const busy = sourceBufferRef.current.updating;
            const hasQueue = audioQueue.current.length > 0;
            if (!busy && !hasQueue) {
              finalize();
            } else if (attempt < 100) { // ~12s worst-case @120ms
              setTimeout(() => tryClose(attempt + 1), 120);
            } else {
              console.warn('[TTS] Forcing endOfStream after timeout. busy:', busy, 'queue:', hasQueue);
              finalize();
            }
          };

          tryClose();
          break;
        }
      }
    };
  }, [conversationId, addMessage, setSpeaking, playFromQueue, setupAudioPlayback]);

  const startMic = useCallback(async () => {
    if (mediaRecorderRef.current) {
      console.log('[Audio] Mic already started.');
      return;
    }
    try {
      console.log('[Audio] Requesting microphone permission...');
      const stream = await navigator.mediaDevices.getUserMedia({
        audio: {
          echoCancellation: true,
          noiseSuppression: true,
          channelCount: 1,
          sampleRate: 48000,
        },
      });
      console.log('[Audio] ✅ Microphone permission granted.');
      const recorder = new MediaRecorder(stream, { mimeType: 'audio/webm; codecs=opus' });
      mediaRecorderRef.current = recorder;

      recorder.ondataavailable = (event) => {
        if (event.data.size > 0 && wsRef.current?.readyState === WebSocket.OPEN) {
          console.log(`[Audio] ➡️ Sending audio chunk of size: ${event.data.size}`);
          wsRef.current.send(event.data);
        } else {
          if (event.data.size > 0) {
            console.log('[Audio] Skipped chunk: WS not open or size zero.', {
              size: event.data.size,
              readyState: wsRef.current?.readyState,
            });
          }
        }
      };

      recorder.onstart = () => {
        console.log('[Audio] ✅ MediaRecorder started.');
      };
      recorder.onerror = (e: any) => {
        console.error('[Audio] ❌ MediaRecorder error:', e);
      };
      recorder.onstop = () => {
        console.log('[Audio] ⏹️ MediaRecorder stopped.');
      };

      recorder.start(250); // Will trigger ondataavailable every 250ms
    } catch (error) {
      console.error('[Audio] ❌ Error starting microphone:', error);
    }
  }, []);

  const stopMic = useCallback(() => {
    if (!mediaRecorderRef.current) return;
    mediaRecorderRef.current.stop();
    mediaRecorderRef.current.stream.getTracks().forEach((track) => track.stop());
    mediaRecorderRef.current = null;
  }, []);

  useEffect(() => {
    connect();
    return () => {
      wsRef.current?.close();
      stopMic();
    };
  }, [connect, stopMic]);

  return { status, startMic, stopMic };
}
