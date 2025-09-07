// Hybrid-mode WebSocket server: requires an existing conversationId via URL and handles only streaming chat.

import 'dotenv/config';
import http from 'node:http';
import { WebSocketServer, WebSocket } from 'ws';
import { getSupabaseServerAdmin } from '@/lib/server/supabaseAdmin';
import { transcribeWebmToText } from '@/lib/server/stt';
import { synthesizeSpeechStream, warmAzureTtsConnection } from '@/lib/server/tts';
import { decrementDailySeconds } from '@/lib/usage';
import { saveMessage, generateAndSaveTitle } from '@/lib/server/conversation-logic';
import { runChat } from '@/lib/llm';

async function streamAssistantReply(
  messages: Array<{ role: 'system' | 'user' | 'assistant'; content: string }>,
  ws: WebSocket,
): Promise<string> {
  const apiKey = process.env.OPENAI_API_KEY || '';
  const model = process.env.OPENAI_MODEL || 'gpt-4o-mini';
  if (!apiKey) throw new Error('OPENAI_API_KEY missing for streaming');

  const res = await fetch('https://api.openai.com/v1/chat/completions', {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${apiKey}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      model,
      messages,
      stream: true,
      max_tokens: 200,
      temperature: 0.7,
    }),
  });
  if (!res.ok || !res.body) {
    const body = await res.text().catch(() => '');
    throw new Error(`OpenAI stream failed: ${res.status} ${body}`);
  }

  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let buf = '';
  let full = '';
  try {
    for (;;) {
      const { value, done } = await reader.read();
      if (done) break;
      buf += decoder.decode(value, { stream: true });
      // SSE frames are separated by double newlines
      const parts = buf.split('\n\n');
      buf = parts.pop() || '';
      for (const part of parts) {
        const lines = part.split('\n').filter(Boolean);
        for (const line of lines) {
          if (!line.startsWith('data:')) continue;
          const payload = line.slice(5).trim();
          if (payload === '[DONE]') {
            // End of stream
            try { reader.releaseLock(); } catch {}
            return full;
          }
          try {
            const json = JSON.parse(payload);
            const content: string = json?.choices?.[0]?.delta?.content || '';
            if (content) {
              full += content;
              if (ws.readyState === 1) {
                ws.send(JSON.stringify({ type: 'assistant_text_chunk', text: content }));
              }
            }
          } catch {
            // ignore JSON parse errors for heartbeats
          }
        }
      }
    }
  } finally {
    try { reader.releaseLock(); } catch {}
  }
  return full;
}

const PORT = Number(process.env.PORT || process.env.WS_PORT || 8080);
const server = http.createServer((req, res) => {
  if (req.url === '/healthz') return res.writeHead(200).end('ok');
  res.writeHead(404).end('Not Found');
});
const wss = new WebSocketServer({ server });

// Warm Azure TTS connection at startup and every 5 minutes (best-effort)
void warmAzureTtsConnection();
setInterval(() => { void warmAzureTtsConnection(); }, 5 * 60 * 1000);

wss.on('connection', async (ws, req) => {
  try {
    const ip = (req.headers['x-forwarded-for'] as string) || (req.socket as any)?.remoteAddress;
    console.log(`[Server] ✅ New client connected from IP: ${ip}`);
  } catch {}
  const url = new URL(req.url || '/', `http://localhost:${PORT}`);
  const conversationId = url.searchParams.get('conversationId');
  const token = url.searchParams.get('token') || '';
  if (!conversationId) return ws.close(1008, 'Missing conversationId');

  const supa = getSupabaseServerAdmin();
  let userId: string | null = null;
  if (token) {
    try { const { data: { user } } = await supa.auth.getUser(token); userId = user?.id ?? null; } catch {}
  }

  let chunkBuffers: Buffer[] = [];
  let flushTimer: NodeJS.Timeout | null = null;
  let isProcessing = false;
  let historyMem: Array<{ role: 'user' | 'assistant'; content: string }> = [];

  // Seed history from DB
  try {
    const { data: hist } = await supa
      .from('messages')
      .select('role, content')
      .eq('conversation_id', conversationId)
      .order('created_at', { ascending: true });
    if (hist) historyMem = hist.map((m: any) => ({ role: m.role, content: m.content }));
  } catch {}

  const flushNow = async () => {
    if (isProcessing || chunkBuffers.length === 0) return;
    isProcessing = true;
    const payload = Buffer.concat(chunkBuffers);
    chunkBuffers = [];
    try {
  const turnStart = Date.now();
  console.time(`[srv] transcription`);
  const transcript = await transcribeWebmToText(new Uint8Array(payload));
  console.timeEnd(`[srv] transcription`);
      if (!transcript) return;

      sendJson(ws, { type: 'transcript', text: transcript });
      historyMem.push({ role: 'user', content: transcript });
      await saveMessage(conversationId, 'user', transcript, userId);

      const messages = [
        { role: 'system', content: 'You are Kira, a friendly and concise AI assistant.' },
        ...historyMem,
      ];
      console.time(`[srv] llm`);
  const assistant = await streamAssistantReply(messages as any, ws).catch(async (e: unknown) => {
        // Fallback to non-streaming on error
        try { console.warn('[Server] LLM streaming failed, falling back:', e); } catch {}
        return await runChat(messages as any);
      });
      console.timeEnd(`[srv] llm`);
      if (!assistant) return;

      // Ensure a final full-text event for compatibility with existing clients
      try { sendJson(ws, { type: 'assistant_text', text: assistant }); } catch {}
      historyMem.push({ role: 'assistant', content: assistant });
      await saveMessage(conversationId, 'assistant', assistant, userId);

      try {
        const newTitle = await generateAndSaveTitle(conversationId, historyMem);
        if (newTitle) sendJson(ws, { type: 'title_update', title: newTitle, conversationId });
      } catch {}

      sendJson(ws, { type: 'audio_start' });
      console.time(`[srv] tts`);
      await new Promise<void>((resolve, reject) => {
        synthesizeSpeechStream(assistant, (chunk) => sendBinary(ws, chunk)).then(resolve).catch(reject);
      });
      console.timeEnd(`[srv] tts`);
      sendJson(ws, { type: 'audio_end' });

      if (userId) {
        const secondsUsed = (Date.now() - turnStart) / 1000;
        try {
          const secondsRemaining = await decrementDailySeconds(userId, secondsUsed);
          if (typeof secondsRemaining === 'number') sendJson(ws, { type: 'usage_update', secondsRemaining });
        } catch {}
      }
    } catch (err) {
      console.error(`Error in flushNow for ${conversationId}:`, err);
    } finally {
      isProcessing = false;
    }
  };

  ws.on('message', (data: Buffer) => {
    try { console.log(`[Server] 📩 Received message chunk. Size: ${data?.byteLength ?? 0} bytes`); } catch {}
    chunkBuffers.push(data);
    if (flushTimer) clearTimeout(flushTimer);
    flushTimer = setTimeout(flushNow, Number(process.env.WS_UTTERANCE_SILENCE_MS || 700));
  });

  ws.on('close', () => {
    console.log('[Server] ❌ Client disconnected.');
  });

  ws.on('error', (err) => {
    console.error('[Server] ❗️ WebSocket error:', err);
  });
});

function sendJson(ws: WebSocket, data: object) { if (ws.readyState === 1) ws.send(JSON.stringify(data)); }
function sendBinary(ws: WebSocket, data: Uint8Array) { if (ws.readyState === 1) ws.send(data); }

server.listen(PORT, () => console.log(`Server listening on port ${PORT}`));

