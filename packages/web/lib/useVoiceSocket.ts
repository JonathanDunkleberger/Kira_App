'use client';
// Singleton voice WebSocket + mic helpers.
import { useEffect, useState } from 'react';

import { useUsage } from './useUsage';
import { usePartialStore } from './partialStore';
import { useAssistantStream } from './assistantStreamStore';

function resolveVoiceWsUrl(): string {
  const url = process.env.NEXT_PUBLIC_WEBSOCKET_URL || '';
  if (!url) throw new Error('Missing NEXT_PUBLIC_WEBSOCKET_URL');
  return url.replace(/^http/i, 'ws');
}

/** Prefer an explicit backend if you have one; else use local /api/voice (Edge). */
// (legacy normalizeWsUrl removed in favor of resolveVoiceWsUrl logic above)

type ConnectOpts = { persona: string; conversationId?: string };

// Supabase removed: token retrieval stub
async function getSupabaseAccessToken(): Promise<string | undefined> {
  return undefined;
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

// --------------------
// Singleton state
// --------------------
let wsRef: WebSocket | null = null;
let connectingRef: Promise<WebSocket> | null = null;
let connectedOnce = false;
// Buffer for streaming TTS
let ttsChunks: Uint8Array[] = [];
let ttsPlaying = false;
function flushTts() {
  if (!ttsChunks.length) return;
  try {
    const parts: BlobPart[] = ttsChunks.map((u) => {
      const slice = u.buffer.slice(u.byteOffset, u.byteOffset + u.byteLength);
      // Force copy into ArrayBuffer if SharedArrayBuffer
      if (slice instanceof ArrayBuffer) return slice;
      return new Uint8Array(slice as any).buffer;
    });
    const blob = new Blob(parts, { type: 'audio/webm' });
    ttsChunks = [];
    const url = URL.createObjectURL(blob);
    const el = document.getElementById('tts-audio') as HTMLAudioElement | null;
    if (el) {
      el.src = url;
      el.play().catch(() => {});
    }
  } catch {}
}

// Mic capture (streaming) – robust codec selection across browsers
function pickMime(): string {
  if (typeof window === 'undefined') return '';
  const can = (t: string) =>
    typeof (window as any).MediaRecorder !== 'undefined' &&
    (window as any).MediaRecorder?.isTypeSupported?.(t);
  const pick = [
    'audio/webm;codecs=opus', // Chrome / Chromium
    'audio/webm',
    'audio/ogg;codecs=opus', // Firefox
    'audio/ogg',
    'audio/mp4', // Safari recent
    'audio/mpeg', // Fallback (MP3)
  ];
  const sel = pick.find(can) ?? '';
  if (!sel) {
    console.warn('[voice] MediaRecorder/codec not supported on this browser');
  }
  return sel;
}
const MIME = pickMime();
let mr: MediaRecorder | null = null;
let micStream: MediaStream | null = null;
let muted = false; // logical mute (prevents sending frames)

// Public mute controls (simple flag)
export function setMuted(v: boolean) {
  muted = v;
}
export function getMuted() {
  return muted;
}

// Diagnostics / one-shot guards
let diag = {
  clientReadySent: false,
  firstHeartbeat: false,
  firstSpeak: false,
  firstTts: false,
  noFramesWarned: false,
  heartbeatTimer: 0 as any,
  frameTimer: 0 as any,
  heartbeatWarnTimeout: 0 as any,
};

function onceWarn(key: string, msg: string) {
  const k = `__warn_${key}` as any;
  if ((onceWarn as any)[k]) return;
  (onceWarn as any)[k] = 1;
  console.warn(msg);
}

function playTtsUrl(url: string) {
  const el = document.getElementById('tts-audio') as HTMLAudioElement | null;
  if (!el) return;
  el.src = url;
  try {
    el.currentTime = 0;
  } catch {}
  el.play().catch(() => {});
}

async function getToken(): Promise<string | undefined> {
  return undefined; // auth stub
}

export async function connectVoice(opts: ConnectOpts) {
  // Build URL
  const base = resolveVoiceWsUrl();
  const url = base.startsWith('ws') ? new URL(base) : new URL(base, window.location.origin);
  if (!url.pathname || url.pathname === '/') url.pathname = '/ws';
  url.searchParams.set('persona', opts.persona);
  if (opts.conversationId) url.searchParams.set('conversationId', opts.conversationId);
  const token = await getToken();
  if (token) url.searchParams.set('token', token);
  url.searchParams.set('visitor', getVisitorId());

  if (wsRef && wsRef.readyState === WebSocket.OPEN) return wsRef;
  if (connectingRef) return connectingRef;

  connectingRef = new Promise<WebSocket>((resolve, reject) => {
    const ws = new WebSocket(url);
    ws.binaryType = 'arraybuffer';
    ws.addEventListener('open', () => {
      wsRef = ws;
      connectingRef = null;
      connectedOnce = true;
      try {
        ws.send(
          JSON.stringify({
            t: 'client_ready',
            persona: opts.persona,
            session: opts.conversationId,
            ua: navigator.userAgent,
          }),
        );
        diag.clientReadySent = true;
        // If no heartbeat within 5s -> warn
        diag.heartbeatWarnTimeout = setTimeout(() => {
          if (!diag.firstHeartbeat) {
            onceWarn(
              'no_heartbeat',
              '[voice][diag] No heartbeat 5s after client_ready. Server may be stalled.',
            );
          }
        }, 5000);
      } catch {}
      resolve(ws);
    });
    ws.addEventListener('error', (e) => {
      connectingRef = null;
      reject(e);
    });
    ws.addEventListener('close', (ev) => {
      if (wsRef === ws) wsRef = null;
      console.warn('[voice][ws] closed', ev.code, ev.reason || '(no reason)');
      if (ev.code !== 1000) {
        onceWarn(
          'abnormal_close',
          `[voice][diag] Abnormal close code=${ev.code}. Check connectivity / auth / server logs.`,
        );
      }
    });
    ws.addEventListener('message', (e) => {
      if (typeof e.data !== 'string') return;
      try {
        const msg = JSON.parse(e.data);
        if (msg.t === 'chat_session') {
          const id = msg.id || msg.chatSessionId || msg.chat_session_id;
          if (id) useUsage.getState().setChatSessionId(id);
        } else if (msg.t === 'heartbeat') {
          const id = msg.chatSessionId || msg.chat_session_id;
          if (id) useUsage.getState().setChatSessionId(id);
          if (!diag.firstHeartbeat) {
            diag.firstHeartbeat = true;
          }
        } else if (msg.t === 'end') {
          useUsage.getState().setChatSessionId(undefined);
        } else if (msg.t === 'tts_url' && typeof msg.url === 'string') {
          playTtsUrl(msg.url);
          if (!diag.firstTts) {
            diag.firstTts = true;
          }
        } else if (msg.t === 'tts_start') {
          ttsChunks = [];
          ttsPlaying = true;
        } else if (msg.t === 'tts_chunk' && typeof msg.b64 === 'string') {
          try {
            const bin = Uint8Array.from(atob(msg.b64), (c) => c.charCodeAt(0));
            ttsChunks.push(bin);
            // Optionally flush mid-way if large
            const total = ttsChunks.reduce((n, c) => n + c.byteLength, 0);
            if (total > 120_000) {
              flushTts();
            }
          } catch {}
        } else if (msg.t === 'tts_end') {
          flushTts();
          ttsPlaying = false;
        } else if (msg.t === 'speak') {
          if (!diag.firstSpeak) diag.firstSpeak = true;
          // On bot speak, clear any lingering partial
          usePartialStore.getState().clear();
          // Finalize assistant streaming if not already
          const as = useAssistantStream.getState();
          if (as.streaming) as.finalize();
        } else if (msg.t === 'error') {
          console.warn('[voice][server][error]', msg.where, msg.message);
        } else if (msg.t === 'limit_exceeded') {
          console.warn('[voice][limit] server reported limit_exceeded');
          // Broadcast via a lightweight global for now; a dedicated store could be added later
          try {
            (window as any).__kiraLimitExceeded = true;
            const ev = new CustomEvent('kira-limit-exceeded', { detail: msg });
            window.dispatchEvent(ev);
          } catch {}
        } else if (msg.t === 'partial') {
          if (typeof msg.text === 'string') usePartialStore.getState().setPartial(msg.text);
        } else if (msg.t === 'transcript') {
          // Final user transcript arrived: clear partial caption
          usePartialStore.getState().clear();
        } else if (msg.type === 'assistant_text_chunk') {
          const as = useAssistantStream.getState();
          if (!as.streaming) as.start();
          if (typeof msg.text === 'string') as.append(msg.text);
        }
      } catch {}
    });
  });
  console.log('[voice][ws] connecting', {
    href: url.toString().replace(/token=[^&]+/, 'token=***'),
  });
  // After open if client_ready not sent within 1s (should be immediate) warn
  setTimeout(() => {
    if (!diag.clientReadySent)
      onceWarn('no_client_ready', '[voice][diag] client_ready not sent within 1s of open.');
  }, 1000);
  return connectingRef;
}

export function sendJson(obj: any) {
  if (wsRef && wsRef.readyState === WebSocket.OPEN) {
    try {
      wsRef.send(JSON.stringify(obj));
    } catch {}
  }
}

function scheduleNoFramesCheck() {
  if (diag.frameTimer) clearTimeout(diag.frameTimer);
  diag.frameTimer = setTimeout(() => {
    if (!diag.noFramesWarned) {
      diag.noFramesWarned = true;
      console.warn('[voice][diag] No audio frames 5s after mic start. Mic permissions?');
    }
  }, 5000) as any;
}

function startStreamingRecorder() {
  try {
    mr = new MediaRecorder(micStream!, { mimeType: MIME });
  } catch (e) {
    console.error('[voice][mic] Failed to create MediaRecorder', e);
    return;
  }
  scheduleNoFramesCheck();
  mr.ondataavailable = (e) => {
    if (!e.data || !e.data.size) return;
    if (muted) return;
    if (!wsRef || wsRef.readyState !== WebSocket.OPEN) return;
    e.data.arrayBuffer().then((buf) => {
      try {
        wsRef?.send(buf);
      } catch {}
    });
  };
  mr.onstop = () => {
    mr = null;
  };
  try {
    // short timeslice for low latency (250ms)
    mr.start(250);
  } catch (e) {
    console.error('[voice][mic] start failed', e);
  }
}

export async function startMic() {
  if (mr) return; // already capturing
  if (!micStream) {
    micStream = await navigator.mediaDevices.getUserMedia({ audio: true });
  }
  muted = false;
  const AudioCtx: any = (window as any).AudioContext || (window as any).webkitAudioContext;
  if (AudioCtx) {
    try {
      const ctx = new AudioCtx();
      if (ctx.state === 'suspended') await ctx.resume();
    } catch {}
  }
  startStreamingRecorder();
}

export function stopMicForUtterance() {
  // In streaming mode treat as mute toggle + stop
  muted = true;
  try {
    mr?.stop();
  } catch {}
  mr = null;
}

export function endCall() {
  try {
    sendJson({ t: 'end_chat' });
  } catch {}
  try {
    wsRef?.close();
  } catch {}
  wsRef = null;
  if (micStream) {
    try {
      micStream.getTracks().forEach((t) => t.stop());
    } catch {}
  }
  mr = null;
  micStream = null;
  muted = true;
  // reset diag (except onceWarn sticky flags)
  diag = {
    clientReadySent: false,
    firstHeartbeat: false,
    firstSpeak: false,
    firstTts: false,
    noFramesWarned: false,
    heartbeatTimer: 0,
    frameTimer: 0,
    heartbeatWarnTimeout: 0,
  };
}

// Compatibility hook returns reactive flags (connected)
export function useVoiceSocket() {
  const [connected, setConnected] = useState<boolean>(
    !!wsRef && wsRef.readyState === WebSocket.OPEN,
  );
  useEffect(() => {
    const id = setInterval(() => {
      const on = !!wsRef && wsRef.readyState === WebSocket.OPEN;
      setConnected((prev) => (prev === on ? prev : on));
    }, 500);
    return () => clearInterval(id);
  }, []);
  return {
    isConnected: connected,
    connect: connectVoice,
    startMic,
    stopMicForUtterance,
    endCall,
    sendJson,
  } as const;
}
