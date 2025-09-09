'use client';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';

import { supaBrowser } from './supabase-browser';
import { useUsage } from './useUsage';

// Unified URL resolution supporting legacy + new env vars and runtime override
function resolveVoiceWsUrl(): string {
  // Highest priority: explicit runtime override for debugging
  if (typeof window !== 'undefined' && (window as any).__VOICE_WS__) {
    return (window as any).__VOICE_WS__;
  }

  // Support BOTH old and new env names
  const newVar = process.env.NEXT_PUBLIC_VOICE_WS_URL; // new
  const oldDev = process.env.NEXT_PUBLIC_WEBSOCKET_URL; // old (dev)
  const oldProd = process.env.NEXT_PUBLIC_WEBSOCKET_URL_PROD; // old (prod)

  // Prefer explicit new var if present
  let candidate = newVar;

  // Otherwise pick env by NODE_ENV
  if (!candidate) {
    candidate = process.env.NODE_ENV === 'production' ? oldProd : oldDev;
  }

  // If someone set localhost for "All Environments", ignore it in prod/preview
  if (candidate && typeof window !== 'undefined') {
    const isLocal = candidate.includes('localhost') || candidate.includes('127.0.0.1');
    const host = window.location.hostname;
    const onRemote = host !== 'localhost' && host !== '127.0.0.1';
    if (isLocal && onRemote) candidate = ''; // force fallback
  }

  // Normalize http(s) -> ws(s)
  if (candidate?.startsWith('http')) {
    candidate = candidate.replace(/^http/i, 'ws');
  }

  // Final fallback: same-origin edge route (works if you kept /api/voice)
  return candidate || '/api/voice';
}

/** Prefer an explicit backend if you have one; else use local /api/voice (Edge). */
// (legacy normalizeWsUrl removed in favor of resolveVoiceWsUrl logic above)

type ConnectOpts = { persona?: string; conversationId?: string };

async function getSupabaseAccessToken(): Promise<string | undefined> {
  try {
    const {
      data: { session },
    } = await supaBrowser().auth.getSession();
    return session?.access_token || undefined;
  } catch {
    return undefined;
  }
}

function getVisitorId(): string {
  try {
    const k = 'kira_visitor_id';
    let id = localStorage.getItem(k);
    if (!id) {
      id = crypto?.randomUUID?.() || Math.random().toString(36).slice(2);
      localStorage.setItem(k, id);
    }
    return id;
  } catch {
    return 'guest';
  }
}

export function useVoiceSocket() {
  const wsRef = useRef<WebSocket | null>(null);
  const openPromiseRef = useRef<Promise<void> | null>(null);
  const openResolveRef = useRef<(() => void) | null>(null);

  const recRef = useRef<MediaRecorder | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const partsRef = useRef<BlobPart[]>([]);
  const mimeRef = useRef<string>('audio/webm');
  const capturingRef = useRef(false);

  const [isConnected, setConnected] = useState(false);
  const [isMuted, setMuted] = useState(false);

  function playUrlOn(audioEl: HTMLAudioElement | null, url: string) {
    if (!audioEl) return;
    audioEl.src = url;
    try {
      audioEl.currentTime = 0;
    } catch {}
    audioEl.play().catch(() => {});
  }

  const usage = useUsage.getState();

  const connect = useCallback(async (opts?: ConnectOpts) => {
    // already connecting/open?
    const cur = wsRef.current;
    if (cur && (cur.readyState === WebSocket.CONNECTING || cur.readyState === WebSocket.OPEN))
      return;

    const base = resolveVoiceWsUrl();
    const url = base.startsWith('ws') ? new URL(base) : new URL(base, window.location.origin);
    if (opts?.persona) url.searchParams.set('persona', opts.persona);
    const savedId =
      opts?.conversationId ||
      useUsage.getState().server?.chatSessionId ||
      (typeof window !== 'undefined'
        ? sessionStorage.getItem('kira_chat_session_id') || undefined
        : undefined);
    if (savedId) url.searchParams.set('conversationId', savedId);
    // identity for RLS
    const token = await getSupabaseAccessToken();
    if (token) url.searchParams.set('token', token);
    url.searchParams.set('visitor', getVisitorId());
    if (!url.pathname || url.pathname === '/') url.pathname = '/ws';
    console.log('[voice][ws] connecting', {
      base,
      href: url.toString().replace(/token=[^&]+/, 'token=***'),
    });
    const ws = new WebSocket(url);
    wsRef.current = ws;

    openPromiseRef.current = new Promise<void>((res) => (openResolveRef.current = res));

    ws.addEventListener('open', () => {
      console.log('[voice][ws] open');
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
        if (process.env.NODE_ENV !== 'production') {
          console.log('[voice][ws] message', msg);
        }
        // capture chat session id
        if (msg.t === 'chat_session') {
          const id = msg.id || msg.chatSessionId || msg.chat_session_id;
          if (id) useUsage.getState().setChatSessionId(id);
        }
        if (msg.t === 'heartbeat') {
          const id = msg.chatSessionId || msg.chat_session_id;
          if (id) useUsage.getState().setChatSessionId(id);
        }
        if (msg.t === 'end') {
          useUsage.getState().setChatSessionId(undefined);
        }
        if (msg.t === 'tts_url' && typeof msg.url === 'string') {
          const el = document.getElementById('tts-audio') as HTMLAudioElement | null;
          playUrlOn(el, msg.url);
          return;
        }
        if (msg.t === 'speak') {
          import('./voiceBus').then(({ voiceBus }) => voiceBus.emit('speaking', !!msg.on));
          return;
        }
      } catch {}
    });

    ws.addEventListener('close', (e) => {
      console.warn('[voice][ws] close', e.code, e.reason || '(no reason)');
      setConnected(false);
      openPromiseRef.current = null;
      openResolveRef.current = null;
    });

    ws.addEventListener('error', (e) => {
      console.warn('[voice][ws] error', e);
      setConnected(false);
      openPromiseRef.current = null;
      openResolveRef.current = null;
    });
  }, []);

  const ensureStream = useCallback(async (constraints?: MediaTrackConstraints) => {
    if (streamRef.current) return streamRef.current;
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
    return stream;
  }, []);

  const startUtterance = useCallback(
    async (constraints?: MediaTrackConstraints) => {
      if (capturingRef.current) return; // already capturing
      await openPromiseRef.current;
      const ws = wsRef.current;
      if (!ws || ws.readyState !== WebSocket.OPEN) return;
      const stream = await ensureStream(constraints);
      const mime = MediaRecorder.isTypeSupported('audio/webm;codecs=opus')
        ? 'audio/webm;codecs=opus'
        : 'audio/webm';
      mimeRef.current = mime;
      partsRef.current = [];
      const rec = new MediaRecorder(stream, { mimeType: mime, audioBitsPerSecond: 48000 });
      recRef.current = rec;
      rec.ondataavailable = (e) => {
        if (e.data && e.data.size) partsRef.current.push(e.data);
      };
      rec.onstop = async () => {
        try {
          const all = new Blob(partsRef.current, { type: mimeRef.current });
          const buf = await all.arrayBuffer();
          const ws2 = wsRef.current;
          if (!ws2 || ws2.readyState !== WebSocket.OPEN) return;
          ws2.send(JSON.stringify({ t: 'audio_begin', mime: mimeRef.current, size: buf.byteLength }));
            ws2.send(buf);
          ws2.send(JSON.stringify({ t: 'audio_end' }));
        } catch (e) {
          console.warn('[voice] failed to assemble utterance', e);
        } finally {
          partsRef.current = [];
          capturingRef.current = false;
        }
      };
      capturingRef.current = true;
      rec.start(); // no timeslice => full header/footer
    },
    [ensureStream],
  );

  const stopUtterance = useCallback(() => {
    if (!capturingRef.current) return;
    try {
      recRef.current?.requestData();
    } catch {}
    try {
      recRef.current?.stop();
    } catch {}
  }, []);

  // Backwards compat: startMic now just ensures stream
  const startMic = useCallback(async (c?: MediaTrackConstraints) => {
    await ensureStream(c);
  }, [ensureStream]);

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
  startMic, // legacy (ensures stream only)
  stopMic,
  startUtterance,
  stopUtterance,
      setMuted: setMutedSafe,
      endCall,
      signal,
    }),
  [isConnected, isMuted, connect, startMic, stopMic, startUtterance, stopUtterance, setMutedSafe, endCall, signal],
  );
}
