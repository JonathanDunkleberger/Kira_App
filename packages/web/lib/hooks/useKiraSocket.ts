'use client';
import { useEffect, useRef, useState, useCallback } from 'react';
import { useAuth } from '@clerk/nextjs';

import { useConversationStore } from '../state/conversation-store';

type SocketStatus = 'connecting' | 'connected' | 'disconnected' | 'error' | 'unauthenticated';

export function useKiraSocket(conversationId: string | null) {
  const { getToken, isLoaded, isSignedIn } = useAuth();
  const wsRef = useRef<WebSocket | null>(null);
  // Audio streaming state
  const audioCtxRef = useRef<AudioContext | null>(null);
  const workletNodeRef = useRef<AudioWorkletNode | null>(null);
  const scriptNodeRef = useRef<ScriptProcessorNode | null>(null);
  const micStreamRef = useRef<MediaStream | null>(null);
  const floatCarryRef = useRef<Float32Array>(new Float32Array(0));
  const inputSampleRateRef = useRef<number>(48000);
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
  // Resolver for server stream readiness (Google STT)
  const streamReadyResolverRef = useRef<(() => void) | null>(null);

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
    if (audioCtxRef.current) {
      console.log('[Audio] Mic already started.');
      return;
    }
    try {
      console.log('[Audio] Requesting microphone permission...');
      const stream = await navigator.mediaDevices.getUserMedia({ audio: { channelCount: 1 } });
      micStreamRef.current = stream;

      // Inform the server to initialize STT stream BEFORE sending audio
      if (wsRef.current?.readyState === WebSocket.OPEN) {
        try {
          wsRef.current.send(
            JSON.stringify({
              t: 'start_stream',
              config: {
                encoding: 'LINEAR16',
                sampleRateHertz: 16000,
                languageCode: 'en-US',
                enableAutomaticPunctuation: true,
                interimResults: true,
              },
            }),
          );
          // Wait for server readiness to avoid dropped audio chunks
          const waitReady = new Promise<void>((resolve) => {
            streamReadyResolverRef.current = resolve;
          });
          const timeout = new Promise<void>((resolve) => setTimeout(resolve, 1500));
          await Promise.race([waitReady, timeout]);
        } catch (e) {
          console.warn('[WS] Failed to send start_stream:', e);
        }
      }

      const ctx = new (window.AudioContext || (window as any).webkitAudioContext)();
      audioCtxRef.current = ctx;
      inputSampleRateRef.current = ctx.sampleRate || 48000;
      const source = ctx.createMediaStreamSource(stream);

      const handleFloatChunk = (float32: Float32Array) => {
        if (!wsRef.current || wsRef.current.readyState !== WebSocket.OPEN) return;
        if (!sendAudioEnabledRef.current) return;
        // Concatenate carry + new chunk
        const prev = floatCarryRef.current;
        const combined = new Float32Array(prev.length + float32.length);
        combined.set(prev, 0);
        combined.set(float32, prev.length);
        // Downsample to 16k
        const ratio = inputSampleRateRef.current / 16000;
        const outLength = Math.max(0, Math.floor(combined.length / ratio));
        const down = new Float32Array(outLength);
        let i = 0;
        for (let j = 0; j < outLength; j++) {
          const idx = Math.min(combined.length - 1, Math.floor(i));
          down[j] = combined[idx] as number;
          i += ratio;
        }
        // Save carry remainder
        const used = Math.floor(outLength * ratio);
        floatCarryRef.current = combined.slice(used);
        // Convert to Int16 PCM
        const pcm = new Int16Array(down.length);
        for (let k = 0; k < down.length; k++) {
          const v = down[k] ?? 0;
          let s = Math.max(-1, Math.min(1, v));
          pcm[k] = s < 0 ? s * 0x8000 : s * 0x7fff;
        }
        wsRef.current.send(pcm.buffer);
      };

      // Prefer AudioWorklet
      try {
        await ctx.audioWorklet.addModule('/worklets/pcm-processor.js');
        const node = new AudioWorkletNode(ctx, 'pcm-processor');
        workletNodeRef.current = node;
        node.port.onmessage = (e) => {
          const chunk = e.data as Float32Array;
          if (chunk && chunk.length) handleFloatChunk(chunk);
        };
        source.connect(node);
        // Ensure processor runs on some output path; connect to destination at zero gain
        const gain = ctx.createGain();
        gain.gain.value = 0;
        node.connect(gain).connect(ctx.destination);
        console.log('[Audio] ✅ AudioWorkletNode started');
      } catch (err) {
        console.warn('[Audio] AudioWorklet unavailable, falling back to ScriptProcessor', err);
        const script = ctx.createScriptProcessor(2048, 1, 1);
        scriptNodeRef.current = script as any;
        script.onaudioprocess = (e: AudioProcessingEvent) => {
          const buf = e.inputBuffer.getChannelData(0);
          handleFloatChunk(new Float32Array(buf));
        };
        source.connect(script);
        script.connect(ctx.destination);
        console.log('[Audio] ✅ ScriptProcessor started');
      }
    } catch (error) {
      console.error('[Audio] ❌ Error starting microphone:', error);
      setAuthError('Microphone access denied');
    }
  }, []);
  const stopMic = useCallback(() => {
    console.log('[DEBUG] stopMic called - stopping audio only');
    // Send EOU but keep connection open
    if (wsRef.current?.readyState === WebSocket.OPEN) {
      try {
        console.log('[DEBUG] Sending EOU, keeping WS open');
        wsRef.current.send(JSON.stringify({ t: 'eou' }));
      } catch (e) {
        console.warn('[WS] Failed to send EOU:', e);
      }
    }
    try {
      workletNodeRef.current?.disconnect();
      scriptNodeRef.current?.disconnect();
      workletNodeRef.current = null;
      scriptNodeRef.current = null;
    } catch {}
    try {
      micStreamRef.current?.getTracks().forEach((t) => t.stop());
      micStreamRef.current = null;
    } catch {}
    try {
      audioCtxRef.current?.close();
    } catch {}
    audioCtxRef.current = null;
    floatCarryRef.current = new Float32Array(0);
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
        // Cleanup any pending stream readiness waiter
        if (streamReadyResolverRef.current) {
          try {
            streamReadyResolverRef.current();
          } finally {
            streamReadyResolverRef.current = null;
          }
        }
        stopMic();
      };

      ws.onmessage = (event) => {
        try {
          const message = JSON.parse(event.data);
          switch (message.t) {
            case 'stream_ready': {
              if (streamReadyResolverRef.current) {
                const resolve = streamReadyResolverRef.current;
                streamReadyResolverRef.current = null;
                resolve();
                console.log('[WS] ✅ Received stream_ready, safe to send audio.');
              }
              break;
            }
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
