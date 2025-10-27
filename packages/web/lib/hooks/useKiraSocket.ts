'use client';
import { useEffect, useRef, useState, useCallback } from 'react';
import { useAuth } from '@clerk/nextjs';

import { useConversationStore } from '../state/conversation-store';

type SocketStatus = 'connecting' | 'connected' | 'disconnected' | 'error' | 'unauthenticated';

export function useKiraSocket(conversationId: string | null) {
  const { getToken, isLoaded, isSignedIn } = useAuth();
  const wsRef = useRef<WebSocket | null>(null);
  const mediaRecorderRef = useRef<MediaRecorder | null>(null);
  const mediaSourceRef = useRef<MediaSource | null>(null);
  const sourceBufferRef = useRef<SourceBuffer | null>(null);
  const audioQueue = useRef<ArrayBuffer[]>([]);
  const [status, setStatus] = useState<SocketStatus>('disconnected');
  const { addMessage, setSpeaking } = useConversationStore();
  const [limitReachedReason, setLimitReachedReason] = useState<string | null>(null);
  const [authError, setAuthError] = useState<string | null>(null);
  // Gate upstream audio during TTS to avoid echo / barge into STT
  const sendAudioEnabledRef = useRef<boolean>(true);
  // Resolver for end-of-turn signal (speak:false)
  const speakFalseResolverRef = useRef<(() => void) | null>(null);

  const safeSend = useCallback((payload: any) => {
    if (wsRef.current?.readyState === WebSocket.OPEN) {
      wsRef.current.send(JSON.stringify(payload));
    }
  }, []);

  const playFromQueue = useCallback(() => {
    if (
      sourceBufferRef.current &&
      !sourceBufferRef.current.updating &&
      audioQueue.current.length > 0
    ) {
      const chunk = audioQueue.current.shift();
      if (chunk) {
        try {
          sourceBufferRef.current.appendBuffer(chunk);
        } catch (e) {
          console.error('[Audio] Error appending buffer:', e);
        }
      }
    }
  }, []);

  const setupAudioPlayback = useCallback(() => {
    if (mediaSourceRef.current) return;
    const audioEl = document.getElementById('tts-audio') as HTMLAudioElement | null;
    if (!audioEl) return;
    const ms = new MediaSource();
    mediaSourceRef.current = ms;
    audioEl.src = URL.createObjectURL(ms);
    ms.addEventListener('sourceopen', () => {
      try {
        const sb = ms.addSourceBuffer('audio/webm; codecs=opus');
        sb.addEventListener('updateend', playFromQueue);
        sourceBufferRef.current = sb;
        console.log('[Audio] ✅ SourceBuffer created.');
      } catch (e) {
        console.error('[Audio] ❌ Error creating SourceBuffer:', e);
      }
    });
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
      // Inform the server to initialize STT stream BEFORE sending audio
      if (wsRef.current?.readyState === WebSocket.OPEN) {
        try {
          wsRef.current.send(JSON.stringify({
            t: 'start_stream',
            config: {
              encoding: 'WEBM_OPUS',
              sampleRateHertz: 48000,
              languageCode: 'en-US',
              enableAutomaticPunctuation: true,
              interimResults: true,
            },
          }));
          // Small delay to allow server to set up stream config
          await new Promise((r) => setTimeout(r, 30));
        } catch (e) {
          console.warn('[WS] Failed to send start_audio:', e);
        }
      }
      const recorder = new MediaRecorder(stream, {
        mimeType: 'audio/webm; codecs=opus',
        audioBitsPerSecond: 128000,
      });
      mediaRecorderRef.current = recorder;
      recorder.ondataavailable = (event) => {
        console.log('[Audio] Data available:', event.data?.size ?? 0, 'bytes');
        if (
          event.data.size > 0 &&
          wsRef.current?.readyState === WebSocket.OPEN &&
          sendAudioEnabledRef.current
        ) {
          wsRef.current.send(event.data);
        }
      };
      recorder.onerror = (e: any) => {
        console.error('[Audio] ❌ MediaRecorder error:', e);
      };
      recorder.start(100);
      console.log('[Audio] ✅ MediaRecorder started');
    } catch (error) {
      console.error('[Audio] ❌ Error starting microphone:', error);
      setAuthError('Microphone access denied');
    }
  }, []);
  const stopMic = useCallback(() => {
    console.log('[DEBUG] stopMic called - stopping audio only');
    if (mediaRecorderRef.current) {
      // Send EOU but keep connection open
      if (wsRef.current?.readyState === WebSocket.OPEN) {
        try {
          console.log('[DEBUG] Sending EOU, keeping WS open');
          wsRef.current.send(JSON.stringify({ t: 'eou' }));
        } catch (e) {
          console.warn('[WS] Failed to send EOU:', e);
        }
      }

      // Only stop the microphone, NOT the WebSocket
      mediaRecorderRef.current.stop();
      mediaRecorderRef.current.stream.getTracks().forEach((t) => t.stop());
      mediaRecorderRef.current = null;
      console.log('[DEBUG] Microphone stopped, WS remains open');
    } else {
      console.log('[DEBUG] No MediaRecorder to stop');
    }
  }, []);

  const connect = useCallback(async () => {
    if (wsRef.current || !conversationId) return;

    // Ensure Clerk state is ready before attempting token
    if (!isLoaded) {
      // Wait briefly for Clerk to load if needed
      await new Promise((r) => setTimeout(r, 50));
    }

    let guestId = localStorage.getItem('kira-guest-id');
    if (!guestId) {
      guestId = crypto.randomUUID();
      localStorage.setItem('kira-guest-id', guestId);
    }

    setStatus('connecting');
    setAuthError(null);

    try {
      const urlBase = process.env.NEXT_PUBLIC_WEBSOCKET_URL;
      if (!urlBase) throw new Error('WebSocket URL not configured');
      const url = new URL(urlBase);
      url.searchParams.set('conversationId', conversationId);
      url.searchParams.set('guestId', guestId);
      if (isSignedIn) {
        const token = await getToken();
        if (token) url.searchParams.set('token', token);
      }

      // Diagnostic: log the URL being used to connect
      console.log('[WS] Attempting connection to:', url.toString());
      const ws = new WebSocket(url.toString());
      wsRef.current = ws;
      ws.binaryType = 'arraybuffer';

      ws.onopen = () => {
        setStatus('connected');
        safeSend({ t: 'client_ready', session: conversationId, ua: navigator.userAgent });
      };

      ws.onerror = (error) => {
        console.error('[WS] ❌ Connection error:', error);
        setStatus('error');
        setAuthError('Connection failed');
      };

      ws.onclose = (event) => {
        console.log('[WS] 🔌 Connection closed:', event.code, event.reason);
        wsRef.current = null;
        setStatus('disconnected');
        // CRITICAL CLEANUP: Clear any pending EOU waiter to avoid dangling promises
        if (speakFalseResolverRef.current) {
          try {
            speakFalseResolverRef.current();
          } finally {
            speakFalseResolverRef.current = null;
          }
          console.log('[WS Cleanup] Cleared pending EOU promise on socket close.');
        }
        stopMic();
      };

      ws.onmessage = (event) => {
        try {
          const message = JSON.parse(event.data);
          switch (message.t) {
            case 'chat_session':
              break;
            case 'transcript':
              addMessage({ role: 'user', content: message.text });
              break;
            case 'assistant_text_chunk':
              addMessage({
                role: 'assistant',
                content: message.text || '',
                isPartial: !message.done,
              });
              break;
            case 'speak': {
              // Server indicates start/stop of assistant speech
              const on = Boolean(message.on);
              setSpeaking(on);
              if (!on) {
                // Resolve any pending waiter for turn end
                if (speakFalseResolverRef.current) {
                  console.log('[WS] ✅ Received speak:false, resolving EOU promise.');
                  const resolve = speakFalseResolverRef.current;
                  speakFalseResolverRef.current = null;
                  resolve();
                }
              }
              break;
            }
            case 'tts_start': {
              audioQueue.current = [];
              setSpeaking(true);
              // Pause sending mic audio upstream while TTS plays
              sendAudioEnabledRef.current = false;
              const audioEl = document.getElementById('tts-audio') as HTMLAudioElement | null;
              if (audioEl) {
                audioEl.muted = false;
                audioEl.play().catch((e) => console.error('[Audio] Play error', e));
              }
              break;
            }
            case 'tts_chunk': {
              // base64 decode to ArrayBuffer and enqueue
              const binaryString = atob(message.b64 as string);
              const len = binaryString.length;
              const bytes = new Uint8Array(len);
              for (let i = 0; i < len; i++) bytes[i] = binaryString.charCodeAt(i);
              audioQueue.current.push(bytes.buffer);
              playFromQueue();
              break;
            }
            case 'tts_end':
              setSpeaking(false);
              // Resume sending mic audio upstream after TTS completes
              sendAudioEnabledRef.current = true;
              break;
            case 'limit_reached':
              setLimitReachedReason(message.reason);
              stopMic();
              break;
            case 'error':
              setAuthError(message.message);
              break;
          }
        } catch (e) {
          console.error('[WS] ❌ Error parsing message:', e);
        }
      };
    } catch (error) {
      console.error('[WS] ❌ Connection setup failed:', error);
      setStatus('error');
      setAuthError(error instanceof Error ? error.message : 'Connection failed');
    }
  }, [
    conversationId,
    isLoaded,
    isSignedIn,
    getToken,
    safeSend,
    addMessage,
    setSpeaking,
    stopMic,
    playFromQueue,
  ]);

  useEffect(() => {
    // Setup audio pipeline once
    setupAudioPlayback();
    if (conversationId) connect();
    return () => {
      if (wsRef.current) wsRef.current.close();
      stopMic();
    };
  }, [connect, conversationId, setupAudioPlayback, stopMic]);

  const waitForServerTurnEnd = useCallback(() => {
    return new Promise<void>((resolve) => {
      speakFalseResolverRef.current = resolve;
    });
  }, []);

  return {
    status,
    startMic,
    stopMic,
    limitReachedReason,
    setLimitReachedReason,
    authError,
    waitForServerTurnEnd,
  };
}
