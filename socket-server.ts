// Hybrid-mode WebSocket server: requires an existing conversationId via URL and handles only streaming chat.

import 'dotenv/config';
import http from 'node:http';

import { WebSocketServer, WebSocket } from 'ws';
import { PrismaClient } from '@prisma/client';

import { getSupabaseServerAdmin } from './lib/server/supabaseAdmin';
// Legacy STT & streaming TTS utilities retained for fallback, but primary path now uses
// single-blob utterance -> OpenAI transcription (no ffmpeg) -> LLM -> optional TTS URL.
import { warmAzureTtsConnection } from './lib/server/tts'; // keep warm to reduce cold starts if TTS reintroduced
import { handleVoiceConnection } from './services/voice-service';
// usageLimiter removed; heartbeat accrual to be implemented
import { saveMessage, generateAndSaveTitle } from './lib/server/conversation-logic';
import { startHeartbeat } from './server/heartbeat';
import { runChat } from './lib/llm';

async function streamAssistantReply(
  messages: Array<{ role: 'system' | 'user' | 'assistant'; content: string }>,
  ws: WebSocket,
  onChunk?: (text: string) => void,
): Promise<string> {
  const apiKey = process.env.OPENAI_API_KEY || '';
  const model = process.env.OPENAI_MODEL || 'gpt-4o-mini';
  if (!apiKey) throw new Error('OPENAI_API_KEY missing for streaming');

  const res = await fetch('https://api.openai.com/v1/chat/completions', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${apiKey}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      model,
      messages,
      stream: true,
      max_tokens: 4096,
      temperature: 0.85,
      top_p: 0.95,
      presence_penalty: 0.2,
      frequency_penalty: 0.1,
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
            try {
              reader.releaseLock();
            } catch {}
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
              try {
                onChunk?.(content);
              } catch {}
            }
          } catch {
            // ignore JSON parse errors for heartbeats
          }
        }
      }
    }
  } finally {
    try {
      reader.releaseLock();
    } catch {}
  }
  return full;
}

const PORT = Number(process.env.PORT || process.env.WS_PORT || 8080);
const server = http.createServer((req, res) => {
  if (req.url === '/healthz') {
    const body = JSON.stringify({ ok: true, clients: wss.clients.size });
    res.writeHead(200, { 'Content-Type': 'application/json' }).end(body);
    return;
  }
  res.writeHead(404).end('Not Found');
});
const wss = new WebSocketServer({ server });

// Warm Azure TTS connection at startup and every 5 minutes (best-effort)
void warmAzureTtsConnection();
setInterval(
  () => {
    void warmAzureTtsConnection();
  },
  5 * 60 * 1000,
);

wss.on('connection', async (ws, req) => {
  try {
    const ip = (req.headers['x-forwarded-for'] as string) || (req.socket as any)?.remoteAddress;
    console.log(`[Server] ✅ New client connected from IP: ${ip}`);
  } catch {}
  const url = new URL(req.url || '/', `http://localhost:${PORT}`);
  let conversationId: string | null = url.searchParams.get('conversationId');
  const token = url.searchParams.get('token') || '';
  const ttsFmt = (url.searchParams.get('tts') as 'webm' | 'mp3' | null) || 'webm';
  const supa = getSupabaseServerAdmin();
  const prisma = new PrismaClient();
  // If no conversationId provided, create a chat_session (conversation) row
  // TODO(auto-resume): In a future iteration we can accept a short-lived resume token here
  // and attempt to look up / re-associate the most recent active chat_session for the user
  // (e.g. last N minutes) instead of always creating a new one. This keeps the current
  // implementation simple (stateless client bootstrap) while allowing transparent
  // reconnection flows later without exposing history UI.
  if (!conversationId) {
    try {
      // Create a guest conversation (no user association yet) using Prisma Conversation model
      const convo = await prisma.conversation.create({
        data: {
          userId: 'guest', // placeholder; optionally replace with a synthetic per-visitor id strategy
          title: 'New Conversation',
          isGuest: true,
        },
      });
      conversationId = convo.id;
      if (conversationId && ws.readyState === 1) {
        ws.send(JSON.stringify({ t: 'chat_session', chatSessionId: conversationId }));
      }
    } catch (e) {
      console.error('Failed to auto-create conversation (prisma)', e);
      return ws.close(1011, 'Failed to create conversation');
    }
  }

  // supa already initialized above
  let userId: string | null = null;
  if (token) {
    try {
      const {
        data: { user },
      } = await supa.auth.getUser(token);
      userId = user?.id ?? null;
    } catch {}
  }

  // Before allowing any audio processing, enforce daily usage limit (user or IP)
  try {
    const origin = process.env.APP_ORIGIN || process.env.NEXT_PUBLIC_APP_URL || '';
    const base = origin || `http://localhost:${PORT}`;
    const checkUrl = new URL('/api/usage/check', base);
    const headers: Record<string, string> = {};
    // Forward auth token via cookie header if present (only if user token exists in query)
    if (token) headers['Authorization'] = `Bearer ${token}`; // may be ignored by route; route uses Clerk normally
    // Attempt fetch; fallback to not blocking if unreachable (fail-open for now)
    const resp = await fetch(checkUrl.toString(), { headers });
    if (resp.ok) {
      const data: any = await resp.json().catch(() => ({}));
      const remaining = Number(data?.secondsRemaining ?? 0);
      if (Number.isFinite(remaining) && remaining <= 0) {
        sendJson(ws as any, {
          t: 'limit_exceeded',
          reason: 'daily_limit',
          message: 'Daily free usage exhausted. Upgrade to continue.',
        });
        try {
          ws.close(4001, 'limit_exceeded');
        } catch {}
        return; // Abort connection setup
      }
    }
  } catch (e) {
    console.warn('[Server] usage check failed (continuing)', (e as any)?.message);
  }

  // Streaming state (no single-blob accumulation variables required now)
  let historyMem: Array<{ role: 'user' | 'assistant'; content: string }> = [];

  // Seed history from Prisma messages table mapped as app_messages
  try {
    if (conversationId) {
      const msgs = await prisma.message.findMany({
        where: { conversationId },
        orderBy: { createdAt: 'asc' },
        select: { sender: true, text: true },
      });
      historyMem = msgs.map((m: { sender: string; text: string }) => ({
        role: m.sender === 'user' ? 'user' : 'assistant',
        content: m.text,
      }));
    }
  } catch {}

  // Attach streaming voice handler (will create its own ws.on('message') listener)
  handleVoiceConnection(ws as any, {
    onFinal: async (text: string) => {
      historyMem.push({ role: 'user', content: text });
      if (conversationId) await saveMessage(conversationId, 'user', text, userId);
      const messages = [
        { role: 'system', content: 'You are Kira, a friendly and concise AI assistant.' },
        ...historyMem,
      ];
      let full = '';
      try {
        full = await streamAssistantReply(messages as any, ws, (chunk) => {
          // already emitted in streamAssistantReply via assistant_text_chunk; hook left for future metrics
        });
      } catch (e) {
        console.error('[srv] streamAssistantReply failed', e);
        sendJson(ws, {
          t: 'error',
          where: 'assistant_stream',
          message: (e as any)?.message || 'assistant stream failed',
        });
        return 'Sorry, I had a problem generating a reply.';
      }
      historyMem.push({ role: 'assistant', content: full });
      if (conversationId) await saveMessage(conversationId, 'assistant', full, userId);
      try {
        const newTitle = await generateAndSaveTitle(conversationId as string, historyMem);
        if (newTitle) sendJson(ws, { t: 'title_update', title: newTitle, conversationId });
      } catch {}
      return full;
    },
  });

  ws.on('close', () => {
    console.log('[Server] ❌ Client disconnected.');
  });

  ws.on('error', (err) => {
    console.error('[Server] ❗️ WebSocket error:', err);
  });

  // Start authoritative heartbeat if user authenticated and we have a conversationId
  try {
    if (userId && conversationId) {
      startHeartbeat(ws, userId, conversationId);
    }
  } catch (e) {
    console.error('Failed to start heartbeat', e);
  }
});

function sendJson(ws: WebSocket, data: object) {
  if (ws.readyState === 1) ws.send(JSON.stringify(data));
}
// Removed legacy flush-mode transcription helpers (transcribeViaOpenAI / guessExt)

server.listen(PORT, () => console.log(`Server listening on port ${PORT}`));
