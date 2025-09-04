// Simple WebSocket server for streaming audio frames and responses
// Run alongside Next.js during development

import 'dotenv/config';
import http from 'node:http';
import { WebSocketServer, WebSocket } from 'ws';
import { transcribeWebmToText } from './lib/server/stt.js';
import { synthesizeSpeech, synthesizeSpeechStream } from './lib/server/tts.js';
import { getSupabaseServerAdmin } from './lib/server/supabaseAdmin.js';

const PORT = Number(process.env.PORT || process.env.WS_PORT || 8080);
const HOST = '0.0.0.0';

const server = http.createServer((req, res) => {
  if (req.url === '/healthz') {
    res.writeHead(200, { 'content-type': 'text/plain' });
    res.end('ok');
    return;
  }
  res.writeHead(200, { 'content-type': 'text/plain' });
  res.end('kira-voice-ws');
});

const wss = new WebSocketServer({ server });
server.listen(PORT, HOST, () => {
  console.log(`HTTP+WS listening on http://${HOST}:${PORT} (Render)`);
});

// Heartbeat: periodically ping all connected clients to prevent idle timeouts
const HEARTBEAT_MS = 30_000;
setInterval(() => {
  try {
    wss.clients.forEach((client) => {
      if (client.readyState === WebSocket.OPEN) {
        try { (client as any).ping(); } catch {}
      }
    });
  } catch {}
}, HEARTBEAT_MS);

wss.on('connection', async (ws, req) => {
  const ip = req.socket.remoteAddress;
  console.log(`WS client connected${ip ? ` from ${ip}` : ''}`);

  // Basic auth via Supabase access token in query ?token=...
  const url = new URL(req.url || '/', `http://localhost:${PORT}`);
  const token = url.searchParams.get('token') || '';
  const conversationId = url.searchParams.get('conversationId') || '';
  const allowNoAuth = (process.env.DEV_ALLOW_NOAUTH || '').toLowerCase() === 'true';
  if (!token && !allowNoAuth) {
    try { ws.close(4401, 'Unauthorized'); } catch {}
    return;
  }
  if (token) {
    try {
      const supa = getSupabaseServerAdmin();
      const { data, error } = await supa.auth.getUser(token);
      if (error || !data?.user?.id) {
        try { ws.close(4401, 'Invalid token'); } catch {}
        return;
      }
      // Optionally, attach user id to connection state
      (ws as any).userId = data.user.id;
    } catch (e) {
      console.error('WS auth error:', e);
      try { ws.close(1011, 'Auth error'); } catch {}
      return;
    }
  }

  // Per-connection state
  let chunkBuffers: Buffer[] = [];
  let flushTimer: NodeJS.Timeout | null = null;
  let processing = false;
  // Ephemeral per-connection memory to ensure continuity even if DB ops fail
  let historyMem: Array<{ role: 'user' | 'assistant'; content: string }> = [];
  const MAX_TURNS = 12;
  const FLUSH_DEBOUNCE_MS = Number(process.env.WS_UTTERANCE_SILENCE_MS || 700);
  // Node 18+ provides global fetch. If running on older Node, consider importing from 'undici'.
  const fetchFn: typeof fetch = fetch;
  const supa = getSupabaseServerAdmin();

  // Seed in-memory history from DB once if a conversationId is provided
  if (conversationId) {
    try {
      const { data: hist, error: selErr } = await supa
        .from('messages')
        .select('role, content')
        .eq('conversation_id', conversationId)
        .order('created_at', { ascending: true })
        .limit(MAX_TURNS);
      if (selErr) {
        console.error('[DB] seed select failed', { conversationId, selErr });
      } else {
        historyMem = (hist || []).map((m: any) => ({ role: m.role, content: m.content }));
        try { console.log({ conversationId, seedHistoryLen: historyMem.length }); } catch {}
      }
    } catch (e) {
      console.error('[DB] seed select threw', e);
    }
  }

  const scheduleFlush = () => {
    if (flushTimer) clearTimeout(flushTimer);
    flushTimer = setTimeout(flushNow, FLUSH_DEBOUNCE_MS);
  };

  const flushNow = async () => {
    if (processing) return;
    if (!chunkBuffers.length) return;
    processing = true;
    const payload = Buffer.concat(chunkBuffers);
    chunkBuffers = [];
    try {
      // 1) STT
      console.time('STT');
      const transcript = await transcribeWebmToText(new Uint8Array(payload));
      console.timeEnd('STT');
      if (transcript) sendJson(ws, { type: 'transcript', text: transcript });
      // 1b) Update in-memory history and persist user message
      if (transcript) {
        historyMem.push({ role: 'user', content: transcript });
        if (historyMem.length > MAX_TURNS) historyMem.splice(0, historyMem.length - MAX_TURNS);
      }
      if (transcript && conversationId) {
        const userId = (ws as any).userId || null;
        const { data: ins, error: insErr } = await supa
          .from('messages')
          .insert({ conversation_id: conversationId, role: 'user', content: transcript, user_id: userId })
          .select('id') as any;
        if (insErr) console.error('[DB] insert user failed', { conversationId, insErr });
        else try { console.log('[DB] inserted user', { conversationId, id: ins?.[0]?.id }); } catch {}
      }

      // 2) LLM — build from in-memory history (already includes last user)
      const messages = [
        { role: 'system' as const, content: 'You are Kira, a helpful, witty voice companion. Keep responses concise and spoken-friendly.' },
        ...historyMem,
      ];
      console.time('LLM');
  const assistant = await runChat(fetchFn, messages);
      console.timeEnd('LLM');
      if (assistant) {
        sendJson(ws, { type: 'assistant_text', text: assistant });
        // update in-memory and persist
        historyMem.push({ role: 'assistant', content: assistant });
        if (historyMem.length > MAX_TURNS) historyMem.splice(0, historyMem.length - MAX_TURNS);
        if (conversationId) {
          const userId = (ws as any).userId || null;
          const { data: insA, error: insErrA } = await supa
            .from('messages')
            .insert({ conversation_id: conversationId, role: 'assistant', content: assistant, user_id: userId })
            .select('id') as any;
          if (insErrA) console.error('[DB] insert assistant failed', { conversationId, insErrA });
          else try { console.log('[DB] inserted assistant', { conversationId, id: insA?.[0]?.id }); } catch {}
        }
      }

      try { console.log({ conversationId: conversationId || '(none)', historyLen: historyMem.length }); } catch {}
  // 3) TTS (WebM Opus) -> binary frames
  console.log('[TTS]', { /* add signals as needed */ });
  if (assistant) {
        sendJson(ws, { type: 'audio_start' });
        console.time('TTS');
        try {
          await synthesizeSpeechStream(assistant, async (chunk: Uint8Array) => {
            try { ws.send(chunk, { binary: true }); } catch (e) { console.error('WS send audio chunk failed:', e); }
          });
        } catch (e) {
          // fallback to non-streaming single send
          try {
            const b64 = await synthesizeSpeech(assistant);
            const buf = Buffer.from(b64, 'base64');
            ws.send(buf, { binary: true });
          } catch (e2) {
            console.error('TTS send failed:', e2);
          }
        } finally {
          console.timeEnd('TTS');
          sendJson(ws, { type: 'audio_end' });
        }
      }
  // Notify client to refresh usage after each turn
  try { sendJson(ws, { type: 'usage_update' }); } catch {}
    } catch (err) {
      console.error('WS pipeline error:', err);
      sendJson(ws, { type: 'error', message: 'Processing error' });
    } finally {
      processing = false;
    }
  };

  ws.on('message', (data: Buffer, isBinary) => {
    const size = data?.byteLength ?? 0;
    // console.log(`WS message received: ${size} bytes${isBinary ? ' (binary)' : ''}`);
    if (isBinary && size) {
      chunkBuffers.push(Buffer.from(data));
      scheduleFlush();
    } else if (size) {
      // JSON-framed control messages
      try {
        const msg = JSON.parse(data.toString('utf8')) as any;
        if (msg?.type === 'utterance_end') {
          if (flushTimer) { clearTimeout(flushTimer); flushTimer = null; }
          void flushNow();
        }
      } catch {
        // ignore non-JSON
      }
    }
  });

  ws.on('close', () => {
    console.log('WS client disconnected');
  if (flushTimer) clearTimeout(flushTimer);
  });

  ws.on('error', (err) => {
    console.error('WS client error:', err);
  });
});

wss.on('error', (err) => {
  console.error('WS server error:', err);
});

function sendJson(ws: any, obj: any) {
  try { ws.send(JSON.stringify(obj)); } catch {}
}

async function runChat(
  fetcher: typeof fetch,
  messages: Array<{ role: 'system' | 'user' | 'assistant'; content: string }>
): Promise<string> {
  const apiKey = process.env.OPENAI_API_KEY || '';
  if (!apiKey) throw new Error('Missing OPENAI_API_KEY');
  const model = process.env.OPENAI_MODEL || 'gpt-4o-mini';
  const r = await fetcher('https://api.openai.com/v1/chat/completions', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${apiKey}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ model, messages, max_tokens: 300 }),
  });
  if (!r.ok) {
    const body = await r.text().catch(() => '');
    throw new Error(`OpenAI chat failed: ${r.status} ${body}`);
  }
  const data: any = await r.json();
  return (data.choices?.[0]?.message?.content ?? '').trim();
}
