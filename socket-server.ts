// Simple WebSocket server for streaming audio frames and responses
// Run alongside Next.js during development

import 'dotenv/config';
import { WebSocketServer } from 'ws';
import OpenAI from 'openai';
import { transcribeWebmToText } from './lib/server/stt.js';
import { synthesizeSpeech, synthesizeSpeechStream } from './lib/server/tts.js';
import { getSupabaseServerAdmin } from './lib/server/supabaseAdmin.js';

const PORT = Number(process.env.WS_PORT || 8080);

const wss = new WebSocketServer({ port: PORT });

wss.on('listening', () => {
  console.log(`WS server listening on ws://localhost:${PORT}`);
});

wss.on('connection', async (ws, req) => {
  const ip = req.socket.remoteAddress;
  console.log(`WS client connected${ip ? ` from ${ip}` : ''}`);

  // Basic auth via Supabase access token in query ?token=...
  const url = new URL(req.url || '/', `http://localhost:${PORT}`);
  const token = url.searchParams.get('token') || '';
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
  const FLUSH_DEBOUNCE_MS = Number(process.env.WS_UTTERANCE_SILENCE_MS || 700);
  const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY || '' });

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
      const transcript = await transcribeWebmToText(new Uint8Array(payload));
      if (transcript) sendJson(ws, { type: 'transcript', text: transcript });
      // 2) LLM
      const messages = [
        { role: 'system' as const, content: 'You are Kira, a helpful, witty voice companion. Keep responses concise and spoken-friendly.' },
        { role: 'user' as const, content: transcript || '(no speech captured)' },
      ];
      const llm = await openai.chat.completions.create({
        model: process.env.OPENAI_MODEL || 'gpt-4o-mini',
        messages,
        max_tokens: 300,
      });
      const assistant = llm.choices?.[0]?.message?.content?.trim() || '';
      if (assistant) sendJson(ws, { type: 'assistant_text', text: assistant });
      // 3) TTS (WebM Opus) -> binary frames
      if (assistant) {
        sendJson(ws, { type: 'audio_start' });
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
          sendJson(ws, { type: 'audio_end' });
        }
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
