'use client';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';

type ConnectOpts = { persona?: string; conversationId?: string };
export type VoiceAPI = {
  isConnected: boolean;
  isMuted: boolean;
  connect: (opts?: ConnectOpts) => Promise<void>;
  startMic: (constraints?: MediaTrackConstraints) => Promise<void>;
  stopMic: () => void;
  setMuted: (m: boolean) => void;
  endCall: () => Promise<void>;
  signal?: (type: string, payload?: any) => void;
};

export function useVoiceSocket(): VoiceAPI {
  const wsRef = useRef<WebSocket | null>(null);
  const recRef = useRef<MediaRecorder | null>(null);
  const streamRef = useRef<MediaStream | null>(null);

  const [isConnected, setConnected] = useState(false);
  const [isMuted, setMutedState] = useState(false);

  const connect = useCallback(async (opts?: ConnectOpts) => {
    if (wsRef.current && wsRef.current.readyState <= 1) return; // already open or connecting
    const url = new URL('/api/voice', window.location.origin);
    if (opts?.persona) url.searchParams.set('persona', opts.persona);
    if (opts?.conversationId) url.searchParams.set('conversationId', opts.conversationId);

    const ws = new WebSocket(url);
    wsRef.current = ws;

    ws.addEventListener('open', () => setConnected(true));
    ws.addEventListener('close', () => setConnected(false));
    ws.addEventListener('error', () => setConnected(false));
    ws.addEventListener('message', () => {
      // handle control / audio messages in higher-level components if desired
    });
  }, []);

  const startMic = useCallback(async (constraints?: MediaTrackConstraints) => {
    // stop any existing
    if (recRef.current) try { recRef.current.stop(); } catch {}
    streamRef.current?.getTracks().forEach(t => t.stop());

    const stream = await navigator.mediaDevices.getUserMedia({
      audio: {
        echoCancellation: true,
        noiseSuppression: true,
        autoGainControl: true,
        channelCount: 1,
        sampleRate: 48000,
        ...constraints,
      }
    });
    streamRef.current = stream;

    const mime = MediaRecorder.isTypeSupported('audio/webm;codecs=opus') ? 'audio/webm;codecs=opus' : 'audio/webm';
    const rec = new MediaRecorder(stream, { mimeType: mime, audioBitsPerSecond: 48000 });
    recRef.current = rec;
    rec.ondataavailable = (e) => {
      if (!e.data || !e.data.size) return;
      const ws = wsRef.current;
      if (ws && ws.readyState === WebSocket.OPEN && !isMuted) {
        ws.send(e.data);
      }
    };
    rec.start(250);
  }, [isMuted]);

  const stopMic = useCallback(() => {
    try { recRef.current?.stop(); } catch {}
    streamRef.current?.getTracks().forEach(t => t.stop());
    recRef.current = null;
    streamRef.current = null;
  }, []);

  const setMuted = useCallback((m: boolean) => {
    setMutedState(m);
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
    try { wsRef.current?.send(JSON.stringify({ t: type, ...(payload||{}) })); } catch {}
  }, []);

  useEffect(() => () => { void endCall(); }, [endCall]);

  return useMemo(() => ({ isConnected, isMuted, connect, startMic, stopMic, setMuted, endCall, signal }), [isConnected, isMuted, connect, startMic, stopMic, setMuted, endCall, signal]);
}
