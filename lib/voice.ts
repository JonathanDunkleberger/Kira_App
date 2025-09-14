'use client';
// Unified voice socket API (standalone) – no external hook dependency.
// Provides:
// - connectVoice({ persona, conversationId })
// - startMic()/stopMicForUtterance()/endCall()
// - sendJson(obj) / sendBinary(buf)
// - subscribe(fn) for raw server messages (JSON parsed or ArrayBuffer)
// - useVoiceSocket() React hook exposing status + helper methods

import { useEffect, useState, useCallback, useRef } from 'react';
import type { ServerEvent, ClientEvent, AnyEvent } from '@/lib/voice-protocol';
import { preferredTtsFormat } from '@/lib/audio';

// Internal singleton state (mimics old implementation minimal surface needed by components)
let ws: WebSocket | null = null;
let connecting: Promise<WebSocket> | null = null;
let micStopper: (() => void) | null = null;
let muted = false;
let status: 'idle' | 'connecting' | 'connected' | 'disconnected' = 'idle';
interface StatusMeta {
  __meta: 'status';
  status: typeof status;
}
type Emitted = ServerEvent | ArrayBuffer | StatusMeta;
type Listener = (msg: Emitted) => void;
const listeners = new Set<Listener>();

function emit(msg: any) {
  for (const l of [...listeners]) {
    try {
      l(msg);
    } catch (e) {
      console.error('voice listener error', e);
    }
  }
}

function setStatus(s: typeof status) {
  status = s;
  emit({ __meta: 'status', status: s });
}

export function subscribe(fn: Listener) {
  listeners.add(fn);
  return () => listeners.delete(fn);
}

export function setMuted(v: boolean) {
  muted = v;
}
export function getMuted() {
  return muted;
}

type ConnectArgs = { persona: string; conversationId?: string };

const WS_BASE =
  process.env.NEXT_PUBLIC_WEBSOCKET_URL_PROD ||
  process.env.NEXT_PUBLIC_WEBSOCKET_URL ||
  (process.env.NODE_ENV !== 'production' ? 'ws://localhost:10000' : undefined);

async function resolveUrl(opts: ConnectArgs) {
  if (!WS_BASE) throw new Error('No WebSocket base URL configured');
  const u = new URL(WS_BASE);
  if (opts.conversationId) u.searchParams.set('conversationId', opts.conversationId);
  u.searchParams.set('persona', opts.persona);
  // Supabase auth token removed; Clerk cookies now used by backend directly.
  try {
    const pref = preferredTtsFormat();
    if (pref?.fmt) u.searchParams.set('tts', pref.fmt);
  } catch {}
  return u.toString();
}

export async function connectVoice(opts: ConnectArgs) {
  if (ws && ws.readyState === WebSocket.OPEN) return ws;
  if (connecting) return connecting;
  setStatus('connecting');
  connecting = (async () => {
    const url = await resolveUrl(opts);
    const socket = new WebSocket(url);
    socket.binaryType = 'arraybuffer';
    socket.onopen = () => {
      setStatus('connected');
    };
    socket.onclose = () => {
      setStatus('disconnected');
    };
    socket.onerror = () => {
      setStatus('disconnected');
    };
    socket.onmessage = (evt) => {
      if (evt.data instanceof ArrayBuffer) {
        emit(evt.data);
        return;
      }
      if (typeof evt.data === 'string') {
        try {
          const parsed = JSON.parse(evt.data) as ServerEvent;
          emit(parsed);
        } catch {
          // ignore non-JSON noise
        }
        return;
      }
      emit(evt.data);
    };
    await new Promise<void>((resolve, reject) => {
      socket.addEventListener('open', () => resolve(), { once: true });
      socket.addEventListener('error', (e) => reject(e), { once: true });
    });
    ws = socket;
    connecting = null;
    return socket;
  })();
  return connecting;
}

export function sendJson(obj: any) {
  if (ws && ws.readyState === WebSocket.OPEN) {
    try {
      ws.send(JSON.stringify(obj));
    } catch (e) {
      console.warn('sendJson failed', e);
    }
  }
}

export function sendBinary(buf: ArrayBuffer | Uint8Array) {
  if (ws && ws.readyState === WebSocket.OPEN) {
    try {
      ws.send(buf as any);
    } catch (e) {
      console.warn('sendBinary failed', e);
    }
  }
}

export function endCall() {
  try {
    sendJson({ t: 'end_chat' });
  } catch {}
  try {
    ws?.close();
  } catch {}
  ws = null;
  if (micStopper) {
    try {
      micStopper();
    } catch {}
  }
  micStopper = null;
  setStatus('disconnected');
}

export async function startMic() {
  if (micStopper) return; // already streaming
  const stream = await navigator.mediaDevices.getUserMedia({
    audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true },
  });
  const mime = (window as any).MediaRecorder?.isTypeSupported?.('audio/webm;codecs=opus')
    ? 'audio/webm;codecs=opus'
    : 'audio/webm';
  const rec = new MediaRecorder(stream, { mimeType: mime, audioBitsPerSecond: 48000 });
  rec.ondataavailable = (e) => {
    if (muted) return;
    if (e.data && e.data.size) {
      e.data.arrayBuffer().then((buf) => {
        if (ws && ws.readyState === WebSocket.OPEN) {
          try {
            ws!.send(buf);
          } catch {}
        }
      });
    }
  };
  rec.start(250);
  micStopper = () => {
    try {
      rec.stop();
    } catch {}
    stream.getTracks().forEach((t) => {
      try {
        t.stop();
      } catch {}
    });
    micStopper = null;
  };
}

export function stopMicForUtterance() {
  muted = true;
  if (micStopper) {
    try {
      micStopper();
    } catch {}
  }
  micStopper = null;
}

// React hook exposing status and allowing components to listen for messages
export function useVoiceSocket(onMessage?: (m: ServerEvent | ArrayBuffer) => void) {
  const [s, setS] = useState(status);
  const onMessageRef = useRef(onMessage);
  onMessageRef.current = onMessage;

  useEffect(() => {
    const unsub = subscribe((m) => {
      if (typeof m === 'object' && m !== null && (m as any).__meta === 'status') {
        setS((m as StatusMeta).status);
        return;
      }
      if (onMessageRef.current) {
        if (m instanceof ArrayBuffer) {
          onMessageRef.current(m);
        } else if ((m as ServerEvent).t) {
          onMessageRef.current(m as ServerEvent);
        }
      }
    });
    return () => {
      unsub();
    };
  }, []);

  const connect = useCallback((args: ConnectArgs) => connectVoice(args), []);
  return {
    status: s,
    connect,
    startMic,
    stopMicForUtterance,
    endCall,
    sendJson,
    sendBinary,
  } as const;
}

export type VoiceStatus = ReturnType<typeof useVoiceSocket>['status'];
