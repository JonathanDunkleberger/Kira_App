"use client";
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
const MIME = (typeof window !== 'undefined' && (window as any).MediaRecorder?.isTypeSupported?.('audio/webm;codecs=opus'))
  ? 'audio/webm;codecs=opus'
  : 'audio/webm';
let mr: MediaRecorder | null = null;
let micStream: MediaStream | null = null;
let parts: BlobPart[] = [];

function playTtsUrl(url: string) {
  const el = document.getElementById('tts-audio') as HTMLAudioElement | null;
  if (!el) return;
  el.src = url;
  try { el.currentTime = 0; } catch {}
  el.play().catch(() => {});
}

async function getToken(): Promise<string | undefined> {
  try {
    const { data: { session } } = await supaBrowser().auth.getSession();
    return session?.access_token || undefined;
  } catch { return undefined; }
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
      wsRef = ws; connectingRef = null; connectedOnce = true;
      try {
        ws.send(JSON.stringify({ t: 'client_ready', persona: opts.persona, session: opts.conversationId, ua: navigator.userAgent }));
      } catch {}
      resolve(ws);
    });
    ws.addEventListener('error', (e) => { connectingRef = null; reject(e); });
    ws.addEventListener('close', () => { if (wsRef === ws) wsRef = null; });
    ws.addEventListener('message', (e) => {
      if (typeof e.data !== 'string') return;
      try {
        const msg = JSON.parse(e.data);
        if (msg.t === 'chat_session') {
          const id = msg.id || msg.chatSessionId || msg.chat_session_id; if (id) useUsage.getState().setChatSessionId(id);
        } else if (msg.t === 'heartbeat') {
          const id = msg.chatSessionId || msg.chat_session_id; if (id) useUsage.getState().setChatSessionId(id);
        } else if (msg.t === 'end') {
          useUsage.getState().setChatSessionId(undefined);
        } else if (msg.t === 'tts_url' && typeof msg.url === 'string') {
          playTtsUrl(msg.url);
        } else if (msg.t === 'speak') {
          import('./voiceBus').then(({ voiceBus }) => voiceBus.emit('speaking', !!msg.on));
        }
      } catch {}
    });
  });
  console.log('[voice][ws] connecting', { href: url.toString().replace(/token=[^&]+/, 'token=***') });
  return connectingRef;
}

export function sendJson(obj: any) {
  if (wsRef && wsRef.readyState === WebSocket.OPEN) {
    try { wsRef.send(JSON.stringify(obj)); } catch {}
  }
}

export async function startMic() {
  if (mr) return; // already capturing
  micStream = await navigator.mediaDevices.getUserMedia({ audio: true });
  mr = new MediaRecorder(micStream, { mimeType: MIME });
  parts = [];
  mr.ondataavailable = (e) => { if (e.data && e.data.size) parts.push(e.data); };
  mr.onstop = async () => {
    try {
      const blob = new Blob(parts, { type: MIME });
      const buf = await blob.arrayBuffer();
      if (!wsRef || wsRef.readyState !== WebSocket.OPEN) return;
      sendJson({ t: 'audio_begin', mime: MIME, size: buf.byteLength });
      wsRef.send(buf);
      sendJson({ t: 'audio_end' });
    } finally {
      parts = [];
      mr = null;
    }
  };
  mr.start();
  const AudioCtx: any = (window as any).AudioContext || (window as any).webkitAudioContext;
  if (AudioCtx) {
    try { const ctx = new AudioCtx(); if (ctx.state === 'suspended') await ctx.resume(); } catch {}
  }
}

export function stopMicForUtterance() {
  if (!mr) return;
  try { mr.requestData(); } catch {}
  try { mr.stop(); } catch {}
}

export function endCall() {
  try { sendJson({ t: 'end_chat' }); } catch {}
  try { wsRef?.close(); } catch {}
  wsRef = null;
  if (micStream) {
    try { micStream.getTracks().forEach(t => t.stop()); } catch {}
  }
  mr = null; micStream = null; parts = [];
}

// Compatibility hook returns reactive flags (connected)
export function useVoiceSocket() {
  const [connected, setConnected] = useState<boolean>(!!wsRef && wsRef.readyState === WebSocket.OPEN);
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
