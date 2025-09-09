'use client';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';

type ConnectOpts = { persona?: string; conversationId?: string };

export function useVoiceSocket() {
  const wsRef = useRef<WebSocket | null>(null);
  const readyRef = useRef<Promise<void> | null>(null);
  const readyResolveRef = useRef<(() => void) | null>(null);

  const recRef = useRef<MediaRecorder | null>(null);
  const streamRef = useRef<MediaStream | null>(null);

  const [isConnected, setConnected] = useState(false);
  const [isMuted, setMuted] = useState(false);

  const connect = useCallback(async (opts?: ConnectOpts) => {
    if (wsRef.current && wsRef.current.readyState <= 1) return; // already connecting/open
    const url = new URL('/api/voice', window.location.origin);
    if (opts?.persona) url.searchParams.set('persona', opts.persona);
    if (opts?.conversationId) url.searchParams.set('conversationId', opts.conversationId);
    const ws = new WebSocket(url);
    wsRef.current = ws;
    readyRef.current = new Promise<void>((resolve) => (readyResolveRef.current = resolve));
    ws.addEventListener('open', () => {
      setConnected(true);
      readyResolveRef.current?.();
      try { ws.send(JSON.stringify({ t: 'client_ready' })); } catch {}
    });
    ws.addEventListener('close', () => {
      setConnected(false);
      readyRef.current = null;
      readyResolveRef.current = null;
    });
    ws.addEventListener('error', () => {
      setConnected(false);
      readyRef.current = null;
      readyResolveRef.current = null;
    });
  }, []);

  const startMic = useCallback(async (constraints?: MediaTrackConstraints) => {
    await readyRef.current; // wait until socket open
    try { recRef.current?.stop(); } catch {}
    streamRef.current?.getTracks().forEach(t => t.stop());
    const stream = await navigator.mediaDevices.getUserMedia({
      audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true, channelCount: 1, sampleRate: 48000, ...constraints }
    });
    streamRef.current = stream;
    const mime = MediaRecorder.isTypeSupported('audio/webm;codecs=opus') ? 'audio/webm;codecs=opus' : 'audio/webm';
    const rec = new MediaRecorder(stream, { mimeType: mime, audioBitsPerSecond: 48000 });
    recRef.current = rec;
    rec.ondataavailable = (e) => {
      if (!e.data || !e.data.size) return;
      const ws = wsRef.current;
      if (!ws || ws.readyState !== WebSocket.OPEN || isMuted) return;
      ws.send(e.data);
    };
    rec.start(250);
  }, [isMuted]);

  const stopMic = useCallback(() => {
    try { recRef.current?.stop(); } catch {}
    streamRef.current?.getTracks().forEach(t => t.stop());
    recRef.current = null;
    streamRef.current = null;
  }, []);

  const setMutedSafe = useCallback((m: boolean) => {
    setMuted(m);
    try { wsRef.current?.send(JSON.stringify({ t: 'mute', muted: m })); } catch {}
  }, []);

  const endCall = useCallback(async () => {
    stopMic();
    try { wsRef.current?.send(JSON.stringify({ t: 'end_chat' })); } catch {}
    try { wsRef.current?.close(); } catch {}
    wsRef.current = null;
    setConnected(false);
  }, [stopMic]);

  const signal = useCallback((type: string, payload?: any) => {
    const ws = wsRef.current;
    if (ws && ws.readyState === WebSocket.OPEN) {
      ws.send(JSON.stringify({ t: type, ...payload }));
    }
  }, []);

  useEffect(() => () => {
    try { recRef.current?.stop(); } catch {}
    try { streamRef.current?.getTracks().forEach(t => t.stop()); } catch {}
    try { wsRef.current?.close(); } catch {}
  }, []);

  return useMemo(() => ({ isConnected, isMuted, connect, startMic, stopMic, setMuted: setMutedSafe, endCall, signal }), [isConnected, isMuted, connect, startMic, stopMic, setMutedSafe, endCall, signal]);
}
