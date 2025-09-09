"use client";
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';

/** Prefer an explicit backend if you have one; else use local /api/voice (Edge). */
const WS_URL =
  (typeof window !== 'undefined' ? (window as any).__VOICE_WS__ : '') ||
  process.env.NEXT_PUBLIC_VOICE_WS_URL ||
  '/api/voice';

type ConnectOpts = { persona?: string; conversationId?: string };

export function useVoiceSocket() {
  const wsRef = useRef<WebSocket | null>(null);
  const openPromiseRef = useRef<Promise<void> | null>(null);
  const openResolveRef = useRef<(() => void) | null>(null);

  const recRef = useRef<MediaRecorder | null>(null);
  const streamRef = useRef<MediaStream | null>(null);

  const [isConnected, setConnected] = useState(false);
  const [isMuted, setMuted] = useState(false);

  function playUrlOn(audioEl: HTMLAudioElement | null, url: string) {
    if (!audioEl) return;
    audioEl.src = url;
    try { audioEl.currentTime = 0; } catch {}
    audioEl.play().catch(() => {});
  }

  const connect = useCallback(async (opts?: ConnectOpts) => {
    // already connecting/open?
    const cur = wsRef.current;
    if (cur && (cur.readyState === WebSocket.CONNECTING || cur.readyState === WebSocket.OPEN))
      return;

    const base = WS_URL.startsWith('ws')
      ? WS_URL
      : new URL(WS_URL, window.location.origin).toString();
    const url = new URL(base);
    if (opts?.persona) url.searchParams.set('persona', opts.persona);
    if (opts?.conversationId) url.searchParams.set('conversationId', opts.conversationId);

    const ws = new WebSocket(url);
    wsRef.current = ws;

    openPromiseRef.current = new Promise<void>((res) => (openResolveRef.current = res));

    ws.addEventListener('open', () => {
      setConnected(true);
      openResolveRef.current?.();
      try {
        ws.send(JSON.stringify({ t: 'client_ready' }));
      } catch {}
    });

    ws.addEventListener('message', (e) => {
      if (typeof e.data !== 'string') return;
      try {
        const msg = JSON.parse(e.data);
        if (msg.t === 'tts_url' && typeof msg.url === 'string') {
          const el = document.getElementById('tts-audio') as HTMLAudioElement | null;
          playUrlOn(el, msg.url);
          return;
        }
        if (msg.t === 'speak') {
          import('@/lib/voiceBus').then(({ voiceBus }) => voiceBus.emit('speaking', !!msg.on));
          return;
        }
      } catch {}
    });

    ws.addEventListener('close', () => {
      setConnected(false);
      openPromiseRef.current = null;
      openResolveRef.current = null;
    });

    ws.addEventListener('error', () => {
      setConnected(false);
      openPromiseRef.current = null;
      openResolveRef.current = null;
    });
  }, []);

  const startMic = useCallback(
    async (constraints?: MediaTrackConstraints) => {
      // wait until WS is open (prevents "CLOSING/CLOSED" errors)
      await openPromiseRef.current;

      // restart cleanly
      try {
        recRef.current?.stop();
      } catch {}
      streamRef.current?.getTracks().forEach((t) => t.stop());

      const stream = await navigator.mediaDevices.getUserMedia({
        audio: {
          echoCancellation: true,
          noiseSuppression: true,
          autoGainControl: true,
          channelCount: 1,
          sampleRate: 48000,
          ...constraints,
        },
      });
      streamRef.current = stream;

      const mime = MediaRecorder.isTypeSupported('audio/webm;codecs=opus')
        ? 'audio/webm;codecs=opus'
        : 'audio/webm';
      const rec = new MediaRecorder(stream, { mimeType: mime, audioBitsPerSecond: 48000 });
      recRef.current = rec;

      rec.ondataavailable = (e) => {
        if (!e.data || !e.data.size) return;
        const ws = wsRef.current;
        if (!ws || ws.readyState !== WebSocket.OPEN || isMuted) return;
        ws.send(e.data);
      };

      rec.start(250);
    },
    [isMuted],
  );

  const stopMic = useCallback(() => {
    try {
      recRef.current?.stop();
    } catch {}
    streamRef.current?.getTracks().forEach((t) => t.stop());
    recRef.current = null;
    streamRef.current = null;
  }, []);

  const setMutedSafe = useCallback((m: boolean) => {
    setMuted(m);
    try {
      wsRef.current?.send(JSON.stringify({ t: 'mute', muted: m }));
    } catch {}
  }, []);

  const endCall = useCallback(async () => {
    stopMic();
    try {
      wsRef.current?.send(JSON.stringify({ t: 'end_chat' }));
    } catch {}
    try {
      wsRef.current?.close();
    } catch {}
    wsRef.current = null;
    setConnected(false);
  }, [stopMic]);

  const signal = useCallback((type: string, payload?: any) => {
    const ws = wsRef.current;
    if (ws && ws.readyState === WebSocket.OPEN) {
      ws.send(JSON.stringify({ t: type, ...payload }));
    }
  }, []);

  useEffect(
    () => () => {
      // cleanup on unmount
      try {
        recRef.current?.stop();
      } catch {}
      streamRef.current?.getTracks().forEach((t) => t.stop());
      try {
        wsRef.current?.close();
      } catch {}
    },
    [],
  );

  return useMemo(
    () => ({
      isConnected,
      isMuted,
      connect,
      startMic,
      stopMic,
      setMuted: setMutedSafe,
      endCall,
      signal,
    }),
    [isConnected, isMuted, connect, startMic, stopMic, setMutedSafe, endCall, signal],
  );
}
