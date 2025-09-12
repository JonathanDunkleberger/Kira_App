// Standalone real-time AI pipeline server (WebSocket):
// 1. Accepts audio (WebM/Opus) frames from client
// 2. Streams them to Deepgram (if configured) for partial + final transcripts
// 3. On finalized user utterance, gathers recent conversation history from Prisma
// 4. Streams OpenAI (or Gemini fallback) LLM response text chunks to client
// 5. Streams Azure (or ElevenLabs) TTS audio chunks back
// 6. Persists Conversation & Message rows; aggregates usage via heartbeats
// 7. Sends structured events (will be formalized in shared protocol file later)

import http from 'http';

import { WebSocketServer, type WebSocket } from 'ws';
import { PrismaClient } from '@prisma/client';

import { synthesizeSpeechStream } from './lib/tts.js';
import { generateReplyWithHistory } from './lib/llm.js';
import { transcribeWebmToText } from './lib/stt.js';

// NOTE: Deepgram streaming optional; if keys present we use real-time partials, else fallback to buffer + Whisper
// To avoid adding a dependency before confirming environment, dynamic import when needed.

const prisma = new PrismaClient();

const port = Number(process.env.PORT) || 10000;
const server = http.createServer((_req, res) => {
  res.writeHead(200, { 'Content-Type': 'text/plain' });
  res.end('Kira voice server online');
});

interface SessionState {
  ws: WebSocket;
  conversationId: string;
  userId?: string; // TODO integrate Clerk
  audioBuffers: Uint8Array[]; // accumulate when not streaming deepgram
  deepgram?: any; // deepgram socket/connection
  lastActivity: number;
  heartbeatTimer?: NodeJS.Timeout;
  usageSecondsAccrued: number;
  usageLastHeartbeat?: number;
  eouTimer?: NodeJS.Timeout;
  busy: boolean;
  closed: boolean;
}

const sessions = new Map<WebSocket, SessionState>();

const EOU_SILENCE_MS = 900; // silence window to finalize utterance
const MAX_HISTORY_MESSAGES = 16; // last N messages for context
const HEARTBEAT_INTERVAL_MS = 1000;
const USAGE_FLUSH_INTERVAL_SECONDS = 30; // flush aggregated usage every 30s

function send(ws: WebSocket, obj: any) {
  try { ws.send(JSON.stringify(obj)); } catch {}
}

async function ensureConversation(userId?: string, conversationId?: string): Promise<string> {
  if (conversationId) {
    try {
      const found = await prisma.conversation.findUnique({ where: { id: conversationId } });
      if (found) return found.id;
    } catch {}
  }
  // create minimal conversation (userId might be undefined for now -> store guest placeholder)
  const conv = await prisma.conversation.create({
    data: {
      userId: userId || 'guest',
      isGuest: !userId,
    },
    select: { id: true },
  });
  return conv.id;
}

async function fetchHistory(conversationId: string) {
  try {
    const rows = await prisma.message.findMany({
      where: { conversationId },
      orderBy: { createdAt: 'asc' },
      select: { role: true, text: true },
      take: MAX_HISTORY_MESSAGES * 2, // approximate; filtered later
    });
    // keep last MAX_HISTORY_MESSAGES user/assistant pairs
    return rows.slice(-MAX_HISTORY_MESSAGES).map(r => ({ role: r.role as 'user' | 'assistant', content: r.text }));
  } catch {
    return [] as Array<{ role: 'user' | 'assistant'; content: string }>;
  }
}

function scheduleEouFinalize(session: SessionState, finalize: () => void) {
  if (session.eouTimer) clearTimeout(session.eouTimer);
  session.eouTimer = setTimeout(finalize, EOU_SILENCE_MS);
}

async function finalizeUtterance(session: SessionState) {
  if (session.busy || session.closed) return;
  if (!session.audioBuffers.length) return; // nothing to process
  session.busy = true;
  const ws = session.ws;
  // Merge buffers
  const total = session.audioBuffers.reduce((n,b)=>n+b.byteLength,0);
  const merged = new Uint8Array(total);
  { let offset=0; for (const buf of session.audioBuffers){ merged.set(buf, offset); offset += buf.byteLength; } }
  session.audioBuffers = [];

  // Transcribe (Whisper REST for now; Deepgram streaming path would have emitted partials already)
  let transcript = '';
  try {
    transcript = await transcribeWebmToText(merged);
  } catch (e: any) {
    send(ws, { t: 'error', message: 'Transcription failed' });
    session.busy = false;
    return;
  }
  if (!transcript) { session.busy = false; return; }
  send(ws, { t: 'transcript', text: transcript });

  // Persist user message
  try {
    await prisma.message.create({ data: { conversationId: session.conversationId, role: 'user', text: transcript, userId: session.userId } });
  } catch {}

  // Fetch history for LLM context
  const history = await fetchHistory(session.conversationId);

  // Stream LLM reply (OpenAI streaming API)
  let assistantFull = '';
  try {
    const openaiKey = process.env.OPENAI_API_KEY;
    if (!openaiKey) throw new Error('OPENAI_API_KEY missing');
    const model = process.env.OPENAI_MODEL || 'gpt-4o-mini';
    const body = JSON.stringify({
      model,
      stream: true,
      messages: [
        { role: 'system', content: 'You are Kira, a concise, empathetic voice companion. Reply conversationally.' },
        ...history.map(h => ({ role: h.role, content: h.content })),
        { role: 'user', content: transcript }
      ],
      temperature: 0.85,
      max_tokens: 512
    });
    const resp = await fetch('https://api.openai.com/v1/chat/completions', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${openaiKey}` },
      body
    });
    if (!resp.ok || !resp.body) throw new Error('OpenAI streaming failed');
    const reader = resp.body.getReader();
    const decoder = new TextDecoder();
    while (true) {
      const { value, done } = await reader.read();
      if (done) break;
      if (!value) continue;
      const chunk = decoder.decode(value, { stream: true });
      for (const line of chunk.split(/\n/)) {
        const trimmed = line.trim();
        if (!trimmed.startsWith('data:')) continue;
        const data = trimmed.slice(5).trim();
        if (data === '[DONE]') break;
        try {
          const json = JSON.parse(data);
          const delta = json.choices?.[0]?.delta?.content;
          if (delta) {
            assistantFull += delta;
            send(ws, { t: 'assistant_text_chunk', text: delta });
          }
        } catch {}
      }
    }
  } catch (e:any) {
    // Fallback: non-streaming
    try {
      const reply = await generateReplyWithHistory(history, transcript);
      assistantFull = reply;
      // Split into pseudo-chunks
      for (const seg of reply.match(/.{1,60}(?:\s|$)/g) || [reply]) {
        send(session.ws, { t: 'assistant_text_chunk', text: seg });
      }
    } catch (e2:any) {
      send(ws, { t: 'error', message: 'LLM failed' });
      session.busy = false;
      return;
    }
  }
  // Mark end of assistant text stream
  send(ws, { t: 'assistant_text_chunk', done: true });

  // Persist assistant message
  if (assistantFull) {
    try { await prisma.message.create({ data: { conversationId: session.conversationId, role: 'assistant', text: assistantFull } }); } catch {}
  }

  // Stream TTS
  try {
    send(ws, { t: 'tts_start' });
    send(ws, { t: 'speak', on: true });
    await synthesizeSpeechStream(assistantFull, async (chunk) => {
      // Base64 encode to keep transport simple
      const b64 = Buffer.from(chunk.buffer, chunk.byteOffset, chunk.byteLength).toString('base64');
      send(ws, { t: 'tts_chunk', b64 });
    });
  } catch (e:any) {
    send(ws, { t: 'error', message: 'TTS failed' });
  } finally {
    send(ws, { t: 'tts_end' });
    send(ws, { t: 'speak', on: false });
  }

  session.busy = false;
}

async function flushUsage(session: SessionState) {
  if (!session.userId) return; // skip guests for now
  if (!session.usageSecondsAccrued) return;
  try {
    const dayStart = new Date();
    dayStart.setHours(0,0,0,0);
    await prisma.dailyUsage.upsert({
      where: { userId_day: { userId: session.userId, day: dayStart } },
      update: { seconds: { increment: session.usageSecondsAccrued } },
      create: { userId: session.userId, day: dayStart, seconds: session.usageSecondsAccrued }
    });
    session.usageSecondsAccrued = 0;
  } catch {}
}

function closeSession(session: SessionState) {
  if (session.closed) return;
  session.closed = true;
  try { if (session.heartbeatTimer) clearInterval(session.heartbeatTimer); } catch {}
  try { if (session.eouTimer) clearTimeout(session.eouTimer); } catch {}
  flushUsage(session).catch(()=>{});
  sessions.delete(session.ws);
}

const wss = new WebSocketServer({ server });
wss.on('connection', async (ws: WebSocket, req) => {
  const url = new URL(req.url || '/', 'http://localhost');
  const requestedConversation = url.searchParams.get('conversationId') || undefined;
  // TODO integrate Clerk user extraction (from cookies or token)
  const userId = undefined;
  const conversationId = await ensureConversation(userId, requestedConversation);
  const state: SessionState = {
    ws,
    conversationId,
    userId,
    audioBuffers: [],
    lastActivity: Date.now(),
    usageSecondsAccrued: 0,
    busy: false,
    closed: false,
  };
  sessions.set(ws, state);
  send(ws, { t: 'chat_session', chatSessionId: conversationId });

  // Heartbeat & usage accrual
  let hbSecondsCounter = 0;
  state.heartbeatTimer = setInterval(() => {
    if (state.closed) return;
    send(ws, { t: 'heartbeat', now: Date.now(), chatSessionId: conversationId });
    hbSecondsCounter += 1;
    state.usageSecondsAccrued += 1; // simplistic: 1 second per heartbeat
    if (hbSecondsCounter >= USAGE_FLUSH_INTERVAL_SECONDS) {
      hbSecondsCounter = 0;
      flushUsage(state).catch(()=>{});
    }
  }, HEARTBEAT_INTERVAL_MS);

  ws.on('message', (raw: WebSocket.RawData, isBinary) => {
    if (typeof raw !== 'string' && !isBinary && !(raw instanceof Buffer)) {
      return; // ignore unknown
    }
    if (typeof raw === 'string') {
      try {
        const msg = JSON.parse(raw);
        switch (msg.t) {
          case 'client_ready': {
            // already set up heartbeats
            break;
          }
          case 'eou': {
            finalizeUtterance(state).catch(()=>{});
            break;
          }
          case 'end_chat': {
            try { ws.close(); } catch {}
            break;
          }
          case 'mute': {
            // no-op for now
            break;
          }
        }
      } catch {}
      return;
    }
    // Binary (Buffer or ArrayBuffer)
    let buf: Uint8Array;
    if (raw instanceof Buffer) {
      buf = new Uint8Array(raw.buffer, raw.byteOffset, raw.byteLength);
    } else if (raw instanceof ArrayBuffer) {
      buf = new Uint8Array(raw);
    } else {
      return;
    }
    state.audioBuffers.push(buf);
    scheduleEouFinalize(state, () => finalizeUtterance(state));
  });

  ws.on('close', () => {
    closeSession(state);
  });
  ws.on('error', () => {
    closeSession(state);
  });
});

server.listen(port, '0.0.0.0', () => {
  console.log(`Voice pipeline server listening on port ${port}`);
});

process.on('SIGTERM', async () => {
  try { await prisma.$disconnect(); } catch {}
  process.exit(0);
});

