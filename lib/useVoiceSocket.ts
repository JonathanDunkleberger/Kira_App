'use client';
// Singleton voice WebSocket + mic helpers.
import { useEffect, useState } from 'react';
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

type ConnectOpts = { persona: string; conversationId?: string };

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

// --------------------
// Singleton state
// --------------------
let wsRef: WebSocket | null = null;
let connectingRef: Promise<WebSocket> | null = null;
let connectedOnce = false;

// Mic capture (single utterance)
const MIME =
  typeof window !== 'undefined' &&
  (window as any).MediaRecorder?.isTypeSupported?.('audio/webm;codecs=opus')
    ? 'audio/webm;codecs=opus'
    : 'audio/webm';
let mr: MediaRecorder | null = null;
let micStream: MediaStream | null = null;
let parts: BlobPart[] = [];
let muted = false; // logical mute (stops auto-restart loop)

// Diagnostics / one-shot guards
let diag = {
  clientReadySent: false,
  firstHeartbeat: false,
  firstUtteranceEnd: false,
  firstSpeak: false,
  firstTts: false,
  noFramesWarned: false,
  heartbeatTimer: 0 as any,
  frameTimer: 0 as any,
  speakTimeout: 0 as any,
  heartbeatWarnTimeout: 0 as any,
};
let __utteranceCounter = 0;

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
  try {
    const {
      data: { session },
    } = await supaBrowser().auth.getSession();
    return session?.access_token || undefined;
  } catch {
    return undefined;
  }
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
            onceWarn('no_heartbeat', '[voice][diag] No heartbeat 5s after client_ready. Server may be stalled.');
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
        onceWarn('abnormal_close', `[voice][diag] Abnormal close code=${ev.code}. Check connectivity / auth / server logs.`);
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
        } else if (msg.t === 'speak') {
          import('./voiceBus').then(({ voiceBus }) => voiceBus.emit('speaking', !!msg.on));
          if (!diag.firstSpeak) diag.firstSpeak = true;
        } else if (msg.t === 'error') {
          console.warn('[voice][server][error]', msg.where, msg.message);
        }
      } catch {}
    });
  });
  console.log('[voice][ws] connecting', {
    href: url.toString().replace(/token=[^&]+/, 'token=***'),
  });
  // After open if client_ready not sent within 1s (should be immediate) warn
  setTimeout(() => {
    if (!diag.clientReadySent) onceWarn('no_client_ready', '[voice][diag] client_ready not sent within 1s of open.');
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
    if (!diag.noFramesWarned && parts.length === 0) {
      diag.noFramesWarned = true;
      console.warn('[voice][diag] No audio frames 5s after mic start. Mic permissions?');
    }
  }, 5000) as any;
}

async function beginRecorder() {
  try {
    mr = new MediaRecorder(micStream!, { mimeType: MIME });
  } catch (e) {
    console.error('[voice][mic] Failed to create MediaRecorder', e);
    return;
  }
  parts = [];
  scheduleNoFramesCheck();
  const idx = ++__utteranceCounter;
  console.log('[voice][mic] utterance start', idx);
  mr.ondataavailable = (e) => {
    if (e.data && e.data.size) parts.push(e.data);
  };
  mr.onstop = async () => {
    try {
      const blob = new Blob(parts, { type: MIME });
      const buf = await blob.arrayBuffer();
      if (!wsRef || wsRef.readyState !== WebSocket.OPEN) return;
      sendJson({ t: 'audio_begin', mime: MIME, size: buf.byteLength, u: idx });
      wsRef.send(buf);
      sendJson({ t: 'audio_end', u: idx });
      if (!diag.firstUtteranceEnd) {
        diag.firstUtteranceEnd = true;
        // After an utterance if no speak/tts in 10s warn
        diag.speakTimeout = setTimeout(() => {
          if (!diag.firstSpeak && !diag.firstTts) {
            onceWarn('no_speak_after_utterance', '[voice][diag] No speak/tts within 10s after first utterance. LLM/TTS path stalled?');
          }
        }, 10000) as any;
      }
      console.log('[voice][mic] utterance sent bytes=', buf.byteLength, 'u=', idx);
    } finally {
      parts = [];
      mr = null;
      if (!muted && wsRef && wsRef.readyState === WebSocket.OPEN) {
        // auto start next recorder (continuous loop)
        beginRecorder();
      }
    }
  };
  try {
    mr.start();
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
  beginRecorder();
}

export function stopMicForUtterance() {
  if (!mr) return;
  try {
    mr.requestData();
  } catch {}
  try {
    mr.stop();
  } catch {}
  muted = true; // prevent auto-restart until explicitly unmuted/startMic called
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
  parts = [];
  muted = true;
  // reset diag (except onceWarn sticky flags)
  diag = {
    clientReadySent: false,
    firstHeartbeat: false,
    firstUtteranceEnd: false,
    firstSpeak: false,
    firstTts: false,
    noFramesWarned: false,
    heartbeatTimer: 0,
    frameTimer: 0,
    speakTimeout: 0,
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
