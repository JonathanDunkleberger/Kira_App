'use client';
// Unified voice socket API bridging legacy singleton usage to the new hook-based implementation.
// This lets components keep calling connectVoice/startMic/etc while we remove lib/useVoiceSocket.ts.

import { preferredTtsFormat } from '@/lib/audio';
import { useVoiceSocket as useVoiceHook } from '@/lib/hooks/useVoiceSocket';

// Internal singleton state (mimics old implementation minimal surface needed by components)
let ws: WebSocket | null = null;
let connecting: Promise<WebSocket> | null = null;
let micStopper: (() => void) | null = null;
let muted = false;

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
  connecting = (async () => {
    const url = await resolveUrl(opts);
    const socket = new WebSocket(url);
    socket.binaryType = 'arraybuffer';
    await new Promise<void>((resolve, reject) => {
      socket.onopen = () => resolve();
      socket.onerror = (e) => reject(e);
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
    } catch {}
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

// Hook facade combining low-level status from new hook + legacy flags
export function useVoiceSocket() {
  const inner = useVoiceHook({ onMessage: () => {} });
  return {
    status: inner.status,
    connect: connectVoice,
    startMic,
    stopMicForUtterance,
    endCall,
    sendJson,
  } as const;
}
