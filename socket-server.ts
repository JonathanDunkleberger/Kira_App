// Simple WebSocket server for streaming audio frames and responses
// Run alongside Next.js during development

import 'dotenv/config';
import http from 'node:http';
import { WebSocketServer, WebSocket } from 'ws';
import { transcribeWebmToText } from '@/lib/server/stt';
import { synthesizeSpeech, synthesizeSpeechStream } from '@/lib/server/tts';
import { getSupabaseServerAdmin } from '@/lib/server/supabaseAdmin';
import { deductUsage } from '@/lib/server/usage';
import { createNewConversation, saveMessage, generateConversationTitle as generateTitle } from '@/lib/server/conversations';
import { generateReplyWithHistory } from '@/lib/llm';
import { getDailySecondsRemaining, decrementDailySeconds } from '@/lib/usage';
import { envServer as env } from '@/lib/server/env.server';

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
  let conversationId: string | null = url.searchParams.get('conversationId') || null;
  const cid = url.searchParams.get('cid') || '';
  const allowNoAuth = (process.env.DEV_ALLOW_NOAUTH || '').toLowerCase() === 'true';
  // Client-advertised preferred TTS container (webm|mp3); default to webm
  const ttsPref = (url.searchParams.get('tts') || 'webm').toLowerCase();
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

  // Emit an initial usage update so clients can refresh without waiting for the first turn
  try {
    const userId = (ws as any).userId as string | undefined;
    let secondsRemaining: number | undefined;
    if (userId) {
      try { secondsRemaining = await getDailySecondsRemaining(userId); } catch {}
    } else if (conversationId) {
      try {
        const { data } = await supa
          .from('conversations')
          .select('seconds_remaining')
          .eq('id', conversationId)
          .maybeSingle();
        secondsRemaining = Number(data?.seconds_remaining ?? env.FREE_TRIAL_SECONDS);
      } catch {}
    } else {
      secondsRemaining = Number(env.FREE_TRIAL_SECONDS);
    }
  sendJson(ws, { type: 'usage_update', secondsRemaining });
  // Inform client of audio format being used for this connection
  sendJson(ws, { type: 'audio_format', format: (ttsPref === 'mp3' ? 'mp3' : 'webm') });
  } catch {}

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
  // Track total turn duration from start of processing to end of TTS
  const turnStart = Date.now();
      const userId = (ws as any).userId || null;

      // If this is the first message and there's no conversationId, create one now
      if (!conversationId) {
        try {
          const newConv = await createNewConversation(userId);
          conversationId = newConv.id;
          (ws as any).conversationId = newConv.id;
          sendJson(ws, { type: 'conversation_created', conversationId: newConv.id });
          console.log(`[DB] Created new conversation ${newConv.id}`);
        } catch (e) {
          console.error('Failed to create conversation:', e);
        }
      }
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
        await saveMessage(conversationId, 'user', transcript, userId);
      }

      // 2) LLM — build from in-memory history (already includes last user)
  console.time('LLM');
  const prior = transcript ? historyMem.slice(0, -1) : historyMem;
  const userText = transcript || historyMem[historyMem.length - 1]?.content || '';
  const assistant = await generateReplyWithHistory(prior as any, userText, /* isPro */ undefined, (ws as any).userId || undefined);
      console.timeEnd('LLM');
      if (assistant) {
        sendJson(ws, { type: 'assistant_text', text: assistant });
        // update in-memory and persist
        historyMem.push({ role: 'assistant', content: assistant });
        if (historyMem.length > MAX_TURNS) historyMem.splice(0, historyMem.length - MAX_TURNS);
        if (conversationId) {
          await saveMessage(conversationId, 'assistant', assistant, userId);
          // Generate a title after first user message
          try {
            const userCount = historyMem.filter(m => m.role === 'user').length;
            if (userCount === 1) {
              const title = await generateTitle(conversationId, historyMem);
              if (title) {
                sendJson(ws, { type: 'title_update', title });
              }
            }
          } catch (te) {
            console.error('Title generation failed', te);
          }
        }
      }

      try { console.log({ conversationId: conversationId || '(none)', historyLen: historyMem.length }); } catch {}
  // 3) TTS -> binary frames (format negotiated per client capability)
  console.log('[TTS]', { /* add signals as needed */ });
  if (assistant) {
        sendJson(ws, { type: 'audio_start' });
        console.time('TTS');
        try {
          // Select output format: WebM Opus (default) or MP3 for Safari/iOS clients
          const useMp3 = ttsPref === 'mp3';
          await new Promise<void>((resolve, reject) => {
            synthesizeSpeechStream(
              assistant,
              (chunk: Uint8Array) => {
                if (ws.readyState === WebSocket.OPEN) {
                  ws.send(chunk, { binary: true }, (err) => {
                    if (err) {
                      console.error('WS send audio chunk failed:', err);
                      // Do not reject; continue streaming
                    }
                  });
                }
              },
              useMp3 ? 'mp3' : 'webm'
            ).then(resolve).catch(reject);
          });
        } catch (e) {
          // fallback to non-streaming single send
          try {
            const b64 = await synthesizeSpeech(assistant, ttsPref === 'mp3' ? 'mp3' : 'webm');
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
  // Total usage duration for the turn in seconds (approx: STT + LLM + TTS wall time)
  const totalSeconds = (Date.now() - turnStart) / 1000;
  // Persist usage deduction and compute new remaining seconds
  try {
    const userId = (ws as any).userId as string | undefined;
    let secondsRemaining: number | undefined;
    if (userId) {
      // For signed-in users, decrement daily entitlements
      const newRem = await decrementDailySeconds(userId, Math.ceil(totalSeconds));
      if (typeof newRem === 'number') secondsRemaining = newRem;
      else secondsRemaining = await getDailySecondsRemaining(userId);
    } else if (conversationId) {
      // Guests: deduct from conversation seconds_remaining via RPC
      await deductUsage(conversationId, totalSeconds);
      try {
        const { data } = await supa
          .from('conversations')
          .select('seconds_remaining')
          .eq('id', conversationId)
          .maybeSingle();
        secondsRemaining = Number(data?.seconds_remaining ?? env.FREE_TRIAL_SECONDS);
      } catch {}
    }
    // Notify client (include secondsRemaining when known)
    sendJson(ws, { type: 'usage_update', secondsRemaining });
  } catch (e) {
    console.error('Usage deduction failed:', e);
    try { sendJson(ws, { type: 'usage_update' }); } catch {}
  }
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

