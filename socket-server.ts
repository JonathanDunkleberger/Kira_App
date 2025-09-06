// Hybrid-mode WebSocket server: requires an existing conversationId via URL and handles only streaming chat.

import 'dotenv/config';
import http from 'node:http';
import { WebSocketServer, WebSocket } from 'ws';
import { getSupabaseServerAdmin } from '@/lib/server/supabaseAdmin';
import { transcribeWebmToText } from '@/lib/server/stt';
import { synthesizeSpeechStream } from '@/lib/server/tts';
import { decrementDailySeconds } from '@/lib/usage';
import { saveMessage, generateAndSaveTitle } from '@/lib/server/conversation-logic';
import { runChat } from '@/lib/llm';

const PORT = Number(process.env.PORT || process.env.WS_PORT || 8080);
const server = http.createServer((req, res) => {
  if (req.url === '/healthz') return res.writeHead(200).end('ok');
  res.writeHead(404).end('Not Found');
});
const wss = new WebSocketServer({ server });

wss.on('connection', async (ws, req) => {
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
      const transcript = await transcribeWebmToText(new Uint8Array(payload));
      if (!transcript) return;

      sendJson(ws, { type: 'transcript', text: transcript });
      historyMem.push({ role: 'user', content: transcript });
      await saveMessage(conversationId, 'user', transcript, userId);

      const messages = [
        { role: 'system', content: 'You are Kira, a friendly and concise AI assistant.' },
        ...historyMem,
      ];
  const assistant = await runChat(messages as any);
      if (!assistant) return;

      sendJson(ws, { type: 'assistant_text', text: assistant });
      historyMem.push({ role: 'assistant', content: assistant });
      await saveMessage(conversationId, 'assistant', assistant, userId);

      try {
        const newTitle = await generateAndSaveTitle(conversationId, historyMem);
        if (newTitle) sendJson(ws, { type: 'title_update', title: newTitle, conversationId });
      } catch {}

      sendJson(ws, { type: 'audio_start' });
      await new Promise<void>((resolve, reject) => {
        synthesizeSpeechStream(assistant, (chunk) => sendBinary(ws, chunk)).then(resolve).catch(reject);
      });
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
    chunkBuffers.push(data);
    if (flushTimer) clearTimeout(flushTimer);
    flushTimer = setTimeout(flushNow, Number(process.env.WS_UTTERANCE_SILENCE_MS || 700));
  });
});

function sendJson(ws: WebSocket, data: object) { if (ws.readyState === 1) ws.send(JSON.stringify(data)); }
function sendBinary(ws: WebSocket, data: Uint8Array) { if (ws.readyState === 1) ws.send(data); }

server.listen(PORT, () => console.log(`Server listening on port ${PORT}`));

