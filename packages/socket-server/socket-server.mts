// moved from root
import { WebSocketServer, WebSocket } from 'ws';
import { PrismaClient } from '@prisma/client';
import { createClient } from '@deepgram/sdk';
import OpenAI from 'openai';
import * as AzureSpeechSDK from 'microsoft-cognitiveservices-speech-sdk';

function requireEnv(name: string): string {
  const value = process.env[name];
  if (!value) {
    console.error(`FATAL: Missing required environment variable "${name}"`);
    process.exit(1);
  }
  return value;
}

const DEEPGRAM_API_KEY = requireEnv('DEEPGRAM_API_KEY');
const OPENAI_API_KEY = requireEnv('OPENAI_API_KEY');
const AZURE_SPEECH_KEY = requireEnv('AZURE_SPEECH_KEY');
const AZURE_SPEECH_REGION = requireEnv('AZURE_SPEECH_REGION');

const prisma = new PrismaClient();
const deepgram = createClient(DEEPGRAM_API_KEY);
const openai = new OpenAI({ apiKey: OPENAI_API_KEY });

const wss = new WebSocketServer({ port: 10000 });
console.log('Voice pipeline server listening on port 10000');

wss.on('connection', async (ws, req) => {
  console.log('[Server] ✅ New client connected.');
  let conversationId: string | null = null;
  let userId: string | null = null;
  let isGuest = true;
  let conversationCreated = false;
  let clientIp: string | null = null;
  try {
    const fwd = req.headers['x-forwarded-for'];
    if (typeof fwd === 'string') clientIp = fwd.split(',')[0].trim();
    else if (Array.isArray(fwd) && fwd.length) clientIp = fwd[0];
    if (!clientIp) // @ts-ignore
      clientIp = req.socket?.remoteAddress || null;
  } catch {}
  try {
    if (req.url) {
      const u = new URL(req.url, 'http://localhost');
      conversationId = u.searchParams.get('conversationId');
      userId = u.searchParams.get('userId');
      isGuest = !userId;
    }
  } catch {}

  function safeSend(payload: unknown) {
    if (ws.readyState === WebSocket.OPEN) {
      try { ws.send(JSON.stringify(payload)); } catch (err) { console.error('[Server] send error', err); }
    }
  }

  const sessionStarted = Date.now();
  let usageInterval: NodeJS.Timeout | null = null;
  function startUsageTicks() {
    if (usageInterval) return;
    usageInterval = setInterval(() => {
      const seconds = Math.floor((Date.now() - sessionStarted) / 1000);
      safeSend({ type: 'usage_update', seconds });
      const DAILY_CAP = parseInt(process.env.FREE_DAILY_SECONDS || '300', 10);
      if (DAILY_CAP > 0) {
        const now = new Date();
        const startOfDay = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()));
        prisma.usage.aggregate({ _sum: { seconds: true }, where: userId ? { userId, date: { gte: startOfDay } } : { userId: null, ip: clientIp || undefined, date: { gte: startOfDay } } })
          .then((agg) => {
            const prior = agg._sum.seconds || 0;
            const projected = prior + seconds;
            if (projected >= DAILY_CAP) { safeSend({ type: 'limit_exceeded', remaining: 0 }); try { ws.close(); } catch {} }
            else { const remaining = Math.max(0, DAILY_CAP - projected); safeSend({ type: 'usage_remaining', remaining }); }
          })
          .catch((e) => console.error('[Server] Usage aggregate error', e));
      }
    }, 5000);
  }

  const dgAny: any = deepgram as any;
  const deepgramLive = dgAny.listen?.live?.({ smart_format: true, model: 'nova-2', language: 'en-US' }) ?? { addListener: () => {}, send: () => {}, finish: () => {} };

  let assistantBusy = false;

  deepgramLive.addListener('transcriptReceived', async (data: any) => {
    try {
      const parsed = JSON.parse(data);
      const transcript = parsed.channel?.alternatives?.[0]?.transcript?.trim();
      if (!transcript) return;
      safeSend({ type: 'user_transcript', text: transcript });
      if (!conversationCreated && conversationId) {
        try { await prisma.conversation.create({ data: { id: conversationId, userId: isGuest ? null : userId || null, isGuest: true } }); conversationCreated = true; } catch (err) { console.error('[Server] Failed to create conversation on first transcript:', err); }
      }
      if (assistantBusy) return;
      assistantBusy = true;
      safeSend({ type: 'assistant_speaking_start' });
      if (conversationCreated && conversationId) {
        try { await prisma.message.create({ data: { conversationId, role: 'user', text: transcript } }); } catch (msgErr) { console.error('[Server] Failed to persist user message', msgErr); }
      }
      let reply = 'Okay.';
      try {
        const completion = await openai.chat.completions.create({ model: 'gpt-3.5-turbo', messages: [{ role: 'system', content: 'You are Kira, a concise, encouraging AI companion. Keep replies short.' }, { role: 'user', content: transcript }], max_tokens: 60, temperature: 0.7 });
        reply = completion.choices[0]?.message?.content?.trim() || reply;
        safeSend({ type: 'assistant_message', text: reply });
        if (conversationCreated && conversationId) { try { await prisma.message.create({ data: { conversationId, role: 'assistant', text: reply } }); } catch (assistErr) { console.error('[Server] Failed to persist assistant message', assistErr); } }
      } catch (err) { console.error('[Server] Assistant generation error', err); safeSend({ type: 'assistant_message', text: reply }); }
      try {
        const speechConfig = AzureSpeechSDK.SpeechConfig.fromSubscription(AZURE_SPEECH_KEY, AZURE_SPEECH_REGION);
        speechConfig.speechSynthesisVoiceName = 'en-US-JennyNeural';
        const audioConfig = AzureSpeechSDK.AudioConfig.fromAudioFileOutput(undefined as unknown as string);
        const synthesizer = new AzureSpeechSDK.SpeechSynthesizer(speechConfig, audioConfig);
        await new Promise<void>((resolve) => {
          synthesizer.speakTextAsync(reply, (result) => { try { if (result?.audioData) { const b64 = Buffer.from(result.audioData).toString('base64'); safeSend({ type: 'assistant_audio', encoding: 'base64', mime: 'audio/wav', data: b64 }); } } catch (e) { console.error('[Server] TTS processing error', e); } finally { synthesizer.close(); resolve(); } }, (error) => { console.error('[Server] TTS synthesis error', error); synthesizer.close(); resolve(); });
        });
      } catch (ttsErr) { console.error('[Server] TTS outer error', ttsErr); } finally { safeSend({ type: 'assistant_speaking_end' }); assistantBusy = false; }
    } catch (err) { console.error('[Server] transcriptReceived handler error', err); }
  });

  ws.on('message', async (message) => {
    if (typeof message === 'string') {
      const event = JSON.parse(message);
      if (event.type === 'client_ready') { conversationId = event.conversationId; userId = event.userId || null; isGuest = !userId; safeSend({ type: 'server_ack', conversationId, guest: isGuest }); startUsageTicks(); }
      else if (event.type === 'user_message') {
        if (!conversationCreated && conversationId) { try { await prisma.conversation.create({ data: { id: conversationId, userId: isGuest ? null : userId || null, isGuest } }); conversationCreated = true; } catch (err) { console.error('[Server] Failed to create conversation on first user text:', err); } }
      }
    } else if (message instanceof Buffer) { deepgramLive.send(message); }
  });

  ws.on('close', async () => {
    deepgramLive.finish();
    if (usageInterval) clearInterval(usageInterval);
    const seconds = Math.max(1, Math.floor((Date.now() - sessionStarted) / 1000));
    try { await prisma.usage.create({ data: { userId: userId || null, seconds, ip: userId ? undefined : clientIp || undefined } }); } catch (uErr) { console.error('[Server] Failed to persist usage', uErr); }
  });

  ws.on('error', (error) => {
    console.error('[Server] WebSocket Error:', error);
    deepgramLive.finish();
    if (usageInterval) clearInterval(usageInterval);
  });
});
