'use client';
import { useEffect, useRef, useState, useCallback } from 'react';
import { useAuth } from '@clerk/nextjs';
import { useConversationStore } from '@/lib/state/conversation-store';

type SocketStatus = 'connecting' | 'connected' | 'disconnected' | 'error';

export function useKiraSocket(conversationId: string | null) {
  const { getToken, isLoaded } = useAuth();
  const wsRef = useRef<WebSocket | null>(null);
  const mediaRecorderRef = useRef<MediaRecorder | null>(null);
  const mediaSourceRef = useRef<MediaSource | null>(null);
  const sourceBufferRef = useRef<SourceBuffer | null>(null);
  const sourceBufferCreatedRef = useRef<boolean>(false);
  const audioQueue = useRef<ArrayBuffer[]>([]);
  const [status, setStatus] = useState<SocketStatus>('disconnected');
  const { addMessage, setSpeaking } = useConversationStore();
  const [limitReachedReason, setLimitReachedReason] = useState<string | null>(null);
  const [authError, setAuthError] = useState<string | null>(null);
  const suppressReconnectRef = useRef(false);
  const tokenRef = useRef<string | null>(null);

  // Attempt to fetch token with retries (handles transient Clerk race on first load)
  const fetchToken = useCallback(async () => {
    if (tokenRef.current) return tokenRef.current;
    // Wait for Clerk auth to load (max ~3s) to avoid premature null token
    let waited = 0;
    while (!isLoaded && waited < 3000) {
      await new Promise((r) => setTimeout(r, 100));
      waited += 100;
    }
    let attempts = 0;
    while (attempts < 5) {
      try {
        const t = await getToken();
        if (t) {
          tokenRef.current = t;
          return t;
        }
      } catch {
        // swallow and retry
      }
      attempts += 1;
      await new Promise((r) => setTimeout(r, 300 * attempts));
    }
    return null;
  }, [getToken, isLoaded]);

  const playFromQueue = useCallback(() => {
    if (
      !sourceBufferRef.current ||
      sourceBufferRef.current.updating ||
      audioQueue.current.length === 0
    )
      return;
    const chunk = audioQueue.current.shift();
    if (!chunk) return;
    try {
      sourceBufferRef.current.appendBuffer(chunk);
    } catch (e) {
      console.error('Error appending audio buffer:', e);
    }
  }, []);

  const setupAudioPlayback = useCallback(() => {
    const audioEl = document.getElementById('tts-audio') as HTMLAudioElement;
    if (!audioEl) return;
    if (!mediaSourceRef.current) {
      const ms = new MediaSource();
      mediaSourceRef.current = ms;
      audioEl.src = URL.createObjectURL(ms);
      ms.addEventListener('sourceopen', () => {
        if (sourceBufferCreatedRef.current) return; // Already created
        if (ms.readyState !== 'open') return;
        if (!MediaSource.isTypeSupported('audio/webm; codecs=opus')) {
          console.error('[Audio] Unsupported MIME type for MediaSource');
          return;
        }
        try {
          const sb = ms.addSourceBuffer('audio/webm; codecs=opus');
          sourceBufferCreatedRef.current = true;
          sb.addEventListener('updateend', playFromQueue);
          sourceBufferRef.current = sb;
          console.log('[Audio] ✅ SourceBuffer created.');
        } catch (e) {
          console.error('[Audio] Failed to add SourceBuffer:', e);
        }
      });
    }
  }, [playFromQueue]);

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
        } else if (event.data.size > 0) {
          console.log('[Audio] Skipped chunk: WS not open or size zero.', {
            size: event.data.size,
            readyState: wsRef.current?.readyState,
          });
        }
      };
      recorder.onstart = () => console.log('[Audio] ✅ MediaRecorder started.');
      recorder.onerror = (e: any) => console.error('[Audio] ❌ MediaRecorder error:', e);
      recorder.onstop = () => console.log('[Audio] ⏹️ MediaRecorder stopped.');
      recorder.start(250);
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

  const connect = useCallback(async () => {
    if (!conversationId || suppressReconnectRef.current) return;
    if (wsRef.current) return;
    setStatus('connecting');
    setAuthError(null);
    const token = await fetchToken();
    if (!token) {
      // Without token we purposefully do not connect to avoid 1008 spam.
      setStatus('error');
      setAuthError('Authentication token unavailable. Please sign in.');
      return;
    }
    const urlBase = process.env.NEXT_PUBLIC_WEBSOCKET_URL;
    if (!urlBase) {
      console.error('[WS] Missing NEXT_PUBLIC_WEBSOCKET_URL env');
      setStatus('error');
      setAuthError('Missing websocket URL configuration.');
      return;
    }
    const url = new URL(urlBase);
    url.searchParams.set('conversationId', conversationId);
    url.searchParams.set('token', token);
    console.log('[WS] Connecting to', url.toString().replace(token, '***'));
    const ws = new WebSocket(url.toString());
    wsRef.current = ws;
    ws.binaryType = 'arraybuffer';
    ws.onopen = () => {
      console.log('[WS] ✅ Open');
      setStatus('connected');
      setupAudioPlayback();
    };
    ws.onerror = (err) => {
      console.error('[WS] Error event', err);
    };
    ws.onclose = (evt) => {
      const code = (evt as CloseEvent).code;
      const reason = (evt as CloseEvent).reason;
      console.warn('[WS] Closed', { code, reason });
      wsRef.current = null;
      if (code === 1008 || code === 4001) {
        suppressReconnectRef.current = true;
        setStatus('error');
        setAuthError(reason || 'Authentication failed.');
        stopMic();
        return;
      }
      setStatus('disconnected');
      if (!limitReachedReason && !suppressReconnectRef.current) {
        setTimeout(() => {
          if (!wsRef.current && !limitReachedReason && !suppressReconnectRef.current) connect();
        }, 1500);
      }
    };
    ws.onmessage = (event) => {
      const msg = JSON.parse(event.data);
      switch (msg.t) {
        case 'limit_reached': {
          setLimitReachedReason(msg.reason || 'limit');
          // Stop microphone to cease further audio capture
          try {
            stopMic();
          } catch {}
          break;
        }
        case 'tts_start': {
          // Hard reset media pipeline so prior buffered data cannot replay.
          audioQueue.current = [];
          // Tear down existing SourceBuffer / MediaSource completely.
          try {
            const sb = sourceBufferRef.current;
            if (sb && (sb as any).abort) {
              try {
                (sb as any).abort();
              } catch {}
            }
          } catch {}
          sourceBufferRef.current = null;
          sourceBufferCreatedRef.current = false;
          if (mediaSourceRef.current) {
            try {
              mediaSourceRef.current.removeEventListener('sourceopen', () => {});
            } catch {}
          }
          mediaSourceRef.current = null;
          const el = document.getElementById('tts-audio') as HTMLAudioElement | null;
          if (el) {
            // Force new MediaSource instance
            el.pause();
            el.removeAttribute('src');
            try {
              el.load();
            } catch {}
          }
          // Recreate media chain lazily
          setupAudioPlayback();
          if (el) {
            el.muted = false;
            el.play?.().catch(() => {});
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
        case 'tts_chunk': {
          const audioChunk = Uint8Array.from(atob(msg.b64), (c) => c.charCodeAt(0)).buffer;
          audioQueue.current.push(audioChunk);
          playFromQueue();
          break;
        }
        case 'tts_end': {
          const ms = mediaSourceRef.current;
          if (!ms) break;
          playFromQueue();
          const finalize = () => {
            try {
              if (mediaSourceRef.current && ms.readyState === 'open') {
                mediaSourceRef.current.endOfStream();
              }
            } catch (e) {
              console.warn('[TTS] endOfStream() failed (ignored):', e);
            }
          };
          const tryClose = (attempt = 0) => {
            playFromQueue();
            const sb = sourceBufferRef.current;
            const busy = sb?.updating;
            const hasQueue = audioQueue.current.length > 0;
            if (!busy && !hasQueue) {
              finalize();
            } else if (attempt < 60) {
              setTimeout(() => tryClose(attempt + 1), 120);
            } else {
              console.warn('[TTS] Forcing endOfStream after timeout.');
              finalize();
            }
          };
          tryClose();
          break;
        }
      }
    };
  }, [conversationId, fetchToken, limitReachedReason, playFromQueue, setupAudioPlayback, stopMic, addMessage, setSpeaking]);

  useEffect(() => {
    // Only attempt connect when we have a conversationId
    connect();
    return () => {
      wsRef.current?.close();
      stopMic();
    };
  }, [connect, stopMic]);

  return { status, startMic, stopMic, limitReachedReason, authError };
}
