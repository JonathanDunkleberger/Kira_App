// WebSocket server for realtime voice chat. Supports both the existing
// URL-parameter mode (conversationId in query) and a command-based flow
// (auth, load_conversation, create_conversation, end_utterance).

import 'dotenv/config';
import http from 'node:http';
import { WebSocketServer, WebSocket } from 'ws';
import { transcribeWebmToText } from '@/lib/server/stt';
import { synthesizeSpeechStream } from '@/lib/server/tts';
import { getSupabaseServerAdmin } from '@/lib/server/supabaseAdmin';
import { generateReplyWithHistory } from '@/lib/llm';
import { createConversation, saveMessage, generateAndSaveTitle } from '@/lib/server/conversation-logic';

const PORT = Number(process.env.PORT || process.env.WS_PORT || 8080);
const HOST = '0.0.0.0';

const server = http.createServer((req, res) => {
  if (req.url === '/healthz') {
    res.writeHead(200, { 'content-type': 'text/plain' }).end('ok');
  } else {
    res.writeHead(200, { 'content-type': 'text/plain' }).end('kira-voice-ws');
  }
});

const wss = new WebSocketServer({ server });
server.listen(PORT, HOST, () => {
  console.log(`HTTP+WS listening on http://${HOST}:${PORT}`);
});

type HistoryMsg = { role: 'user' | 'assistant'; content: string };
type ConnState = {
  userId: string | null;
  conversationId: string | null;
  historyMem: HistoryMsg[];
  chunkBuffers: Buffer[];
  flushTimer: NodeJS.Timeout | null;
  isProcessing: boolean;
  ttsFmt: 'webm' | 'mp3';
};

const MAX_TURNS = 12;
const FLUSH_DEBOUNCE_MS = Number(process.env.WS_UTTERANCE_SILENCE_MS || 700);

const stateMap = new Map<WebSocket, ConnState>();

// Heartbeat to keep connections alive
setInterval(() => {
  try {
    wss.clients.forEach((client) => {
      if (client.readyState === WebSocket.OPEN) {
        try { (client as any).ping?.(); } catch {}
      }
    });
  } catch {}
}, 30_000);

wss.on('connection', async (ws, req) => {
  const url = new URL(req.url || '/', `http://localhost:${PORT}`);
  const token = url.searchParams.get('token') || '';
  const urlConversationId = url.searchParams.get('conversationId');
  const tts = (url.searchParams.get('tts') || 'webm').toLowerCase() as 'webm' | 'mp3';
  const allowNoAuth = (process.env.DEV_ALLOW_NOAUTH || '').toLowerCase() === 'true';

  const supa = getSupabaseServerAdmin();
  let userId: string | null = null;
  if (token) {
    try {
      const { data, error } = await supa.auth.getUser(token);
      if (error) throw error;
      userId = data?.user?.id ?? null;
    } catch (e) {
      if (!allowNoAuth) {
        try { ws.close(4401, 'Invalid token'); } catch {}
        return;
      }
    }
  } else if (!allowNoAuth) {
    try { ws.close(4401, 'Unauthorized'); } catch {}
    return;
  }

  stateMap.set(ws, {
    userId,
    conversationId: urlConversationId || null,
    historyMem: [],
    chunkBuffers: [],
    flushTimer: null,
    isProcessing: false,
    ttsFmt: tts === 'mp3' ? 'mp3' : 'webm',
  });

  // If a conversationId is provided in URL, seed history for compatibility
  if (urlConversationId) {
    await seedHistory(ws);
  }

  ws.on('message', async (message: WebSocket.RawData, isBinary) => {
    const state = stateMap.get(ws);
    if (!state) return;
    if (isBinary || Buffer.isBuffer(message)) {
      // Binary audio data
      state.chunkBuffers.push(Buffer.isBuffer(message) ? message : Buffer.from(message as any));
      scheduleFlush(ws);
      return;
    }
    // JSON control messages
    try {
      const buf = Buffer.isBuffer(message)
        ? message
        : Array.isArray(message)
          ? Buffer.concat(message as Buffer[])
          : Buffer.from(message as ArrayBuffer);
      const msg = JSON.parse(buf.toString('utf8')) as any;
      await handleControl(ws, msg);
    } catch (e) {
      console.warn('Invalid JSON from client');
    }
  });

  ws.on('close', () => {
    const s = stateMap.get(ws);
    if (s?.flushTimer) clearTimeout(s.flushTimer);
    stateMap.delete(ws);
  });

  ws.on('error', (err) => console.error('WS client error:', err));
});

async function seedHistory(ws: WebSocket) {
  const s = stateMap.get(ws);
  if (!s?.conversationId) return;
  try {
    const supa = getSupabaseServerAdmin();
    const { data } = await supa
      .from('messages')
      .select('role, content')
      .eq('conversation_id', s.conversationId)
      .order('created_at', { ascending: true })
      .limit(MAX_TURNS);
    s.historyMem = (data || []).map((m: any) => ({ role: m.role, content: m.content }));
  } catch (e) {
    console.warn('Seed history failed:', e);
  }
}

async function handleControl(ws: WebSocket, msg: any) {
  const s = stateMap.get(ws)!;
  switch (msg?.type) {
    case 'auth': {
      // Optional auth after connect
      try {
        const supa = getSupabaseServerAdmin();
        const { data } = await supa.auth.getUser(String(msg?.token || ''));
        s.userId = data?.user?.id ?? null;
      } catch {}
      break;
    }
    case 'load_conversation': {
      s.conversationId = String(msg?.conversationId || '') || null;
      s.historyMem = [];
      await seedHistory(ws);
      break;
    }
    case 'create_conversation': {
      const conv = await createConversation(s.userId);
      s.conversationId = conv.id;
      s.historyMem = [];
      sendJson(ws, { type: 'conversation_created', conversation: conv });
      break;
    }
    case 'end_utterance':
    case 'utterance_end': {
      const st = stateMap.get(ws);
      if (st?.flushTimer) { clearTimeout(st.flushTimer); st.flushTimer = null; }
      await flushNow(ws);
      break;
    }
  }
}

function scheduleFlush(ws: WebSocket) {
  const s = stateMap.get(ws);
  if (!s) return;
  if (s.flushTimer) clearTimeout(s.flushTimer);
  s.flushTimer = setTimeout(() => { void flushNow(ws); }, FLUSH_DEBOUNCE_MS);
}

async function flushNow(ws: WebSocket) {
  const s = stateMap.get(ws)!;
  if (s.isProcessing || s.chunkBuffers.length === 0) return;
  if (!s.conversationId) {
    sendJson(ws, { type: 'error', message: 'No conversation loaded' });
    s.chunkBuffers = [];
    return;
  }
  s.isProcessing = true;
  const payload = Buffer.concat(s.chunkBuffers);
  s.chunkBuffers = [];

  try {
    // 1) STT
    const transcript = await transcribeWebmToText(new Uint8Array(payload));
    if (!transcript) return;
    sendJson(ws, { type: 'transcript', text: transcript });
    s.historyMem.push({ role: 'user', content: transcript });
    await saveMessage(s.conversationId, 'user', transcript, s.userId);

    // 2) LLM (use in-memory history for context)
    const prior = s.historyMem.slice(0, -1);
    const lastUser = transcript;
    const assistant = await generateReplyWithHistory(prior as any, lastUser, /* isPro */ undefined, s.userId || undefined);
    sendJson(ws, { type: 'assistant_text', text: assistant });
    s.historyMem.push({ role: 'assistant', content: assistant });
    if (s.historyMem.length > MAX_TURNS) s.historyMem.splice(0, s.historyMem.length - MAX_TURNS);
    await saveMessage(s.conversationId, 'assistant', assistant, s.userId);

    // 3) Title generation (early)
    try {
      const title = await generateAndSaveTitle(s.conversationId, s.historyMem);
      if (title) sendJson(ws, { type: 'title_update', title, conversationId: s.conversationId });
    } catch {}

    // 4) TTS streaming
    sendJson(ws, { type: 'audio_start' });
    await new Promise<void>((resolve, reject) => {
      synthesizeSpeechStream(assistant, (chunk) => sendBinary(ws, chunk), s.ttsFmt).then(resolve).catch(reject);
    });
  } catch (err) {
    console.error('Pipeline error:', err);
    sendJson(ws, { type: 'error', message: 'Processing error' });
  } finally {
    sendJson(ws, { type: 'audio_end' });
    s.isProcessing = false;
  }
}

function sendJson(ws: WebSocket, data: object) {
  if (ws.readyState === WebSocket.OPEN) {
    try { ws.send(JSON.stringify(data)); } catch {}
  }
}
function sendBinary(ws: WebSocket, data: Uint8Array) {
  if (ws.readyState === WebSocket.OPEN) {
    try { ws.send(data, { binary: true }); } catch {}
  }
}

