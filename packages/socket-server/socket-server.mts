// FILE: packages/socket-server/socket-server.mts
import 'dotenv/config';
import { WebSocketServer, WebSocket } from 'ws';
import http from 'node:http';
import { PrismaClient } from '@prisma/client';
import { createClient as createDeepgramClient } from '@deepgram/sdk';
import OpenAI from 'openai';
import * as AzureSpeechSDK from 'microsoft-cognitiveservices-speech-sdk';
import type { ServerEvent } from './lib/voice-protocol.js';

function requireEnv(name: string): string {
  const value = process.env[name];
  if (!value) {
    console.error(`FATAL: Missing required environment variable "${name}"`);
    process.exit(1);
  }
  return value;
}

// --- CONFIGURATION ---
const DEEPGRAM_API_KEY = requireEnv('DEEPGRAM_API_KEY');
const OPENAI_API_KEY = requireEnv('OPENAI_API_KEY');
const AZURE_SPEECH_KEY = requireEnv('AZURE_SPEECH_KEY');
const AZURE_SPEECH_REGION = requireEnv('AZURE_SPEECH_REGION');
const PORT = parseInt(process.env.PORT || '10000', 10);

// --- SERVICES ---
const prisma = new PrismaClient();
const deepgram = createDeepgramClient(DEEPGRAM_API_KEY);
const openai = new OpenAI({ apiKey: OPENAI_API_KEY });

// --- HTTP SERVER for Health Checks & WebSocket Upgrades ---
const server = http.createServer((req, res) => {
  if (req.method === 'GET' && req.url === '/healthz') {
    res.statusCode = 200;
    res.end('ok');
  } else {
    res.statusCode = 404;
    res.end();
  }
});

const wss = new WebSocketServer({ noServer: true });

server.on('upgrade', (req, socket, head) => {
  const origin = req.headers.origin || '';
  // Allow localhost and Vercel deployments
  const allowed = /^(https?:\/\/localhost(:\d+)?|https?:\/\/.*\.vercel\.app)$/i;
  if (!allowed.test(origin)) {
    console.warn(`[Server] Denying connection from origin: ${origin}`);
    socket.destroy();
    return;
  }
  wss.handleUpgrade(req, socket, head, (ws) => {
    wss.emit('connection', ws, req);
  });
});

// --- WEBSOCKET CONNECTION HANDLING ---
wss.on('connection', async (ws, req) => {
  console.log('[Server] ✅ New client connected.');
  const conversationId = new URL(req.url!, 'http://localhost').searchParams.get('conversationId');
  if (!conversationId) {
    console.warn('[Server] Connection closed: Missing conversationId');
    ws.close(1008, 'Missing conversationId');
    return;
  }

  const safeSend = (payload: ServerEvent) => {
    if (ws.readyState === WebSocket.OPEN) ws.send(JSON.stringify(payload));
  };

  const deepgramLive = deepgram.listen.live({
    smart_format: true, model: 'nova-2', language: 'en-US', encoding: 'opus',
  });

  deepgramLive.on('error', (e) => console.error('[DG] Error:', e));

  let assistantBusy = false;
  let sentenceBuffer = '';

  deepgramLive.on('transcript', async (data) => {
    const transcript = (data as any).channel.alternatives[0].transcript.trim();
    if (!transcript || assistantBusy) return;

    assistantBusy = true;
    safeSend({ t: 'transcript', text: transcript });
    safeSend({ t: 'speak', on: true });

    await prisma.message.create({
      data: { conversationId, role: 'user', text: transcript },
    }).catch(e => console.error('[DB] Failed to save user message:', e));

    let fullResponse = '';

    const speechConfig = AzureSpeechSDK.SpeechConfig.fromSubscription(AZURE_SPEECH_KEY, AZURE_SPEECH_REGION);
    speechConfig.speechSynthesisOutputFormat = AzureSpeechSDK.SpeechSynthesisOutputFormat.Webm24Khz16BitMonoOpus;
    speechConfig.speechSynthesisVoiceName = 'en-US-JennyNeural';
    const synthesizer = new AzureSpeechSDK.SpeechSynthesizer(speechConfig, undefined);

    try {
      const stream = await openai.chat.completions.create({
        model: 'gpt-4o-mini',
        messages: [{ role: 'system', content: 'You are Kira, a concise, encouraging AI companion.' }, { role: 'user', content: transcript }],
        stream: true,
      });
      
      safeSend({ t: 'tts_start' });

      for await (const chunk of stream) {
        const content = (chunk as any).choices[0]?.delta?.content || '';
        if (content) {
          fullResponse += content;
          sentenceBuffer += content;
          safeSend({ t: 'assistant_text_chunk', text: content });

          // Check for sentence-ending punctuation and flush to TTS
          const sentenceEndMatch = sentenceBuffer.match(/[^.!?]+[.!?]+/);
          if (sentenceEndMatch) {
            const sentence = sentenceEndMatch[0];
            sentenceBuffer = sentenceBuffer.substring(sentence.length);
            
            synthesizer.speakTextAsync(sentence, result => {
              if (result.reason === AzureSpeechSDK.ResultReason.SynthesizingAudioCompleted) {
                if ((result as any).audioData) {
                  safeSend({ t: 'tts_chunk', b64: Buffer.from((result as any).audioData).toString('base64') });
                }
              }
            });
          }
        }
      }

      // Synthesize any remaining text in the buffer after the stream ends
      if (sentenceBuffer.trim().length > 0) {
        synthesizer.speakTextAsync(sentenceBuffer.trim(), result => {
          if (result.reason === AzureSpeechSDK.ResultReason.SynthesizingAudioCompleted) {
            if ((result as any).audioData) {
              safeSend({ t: 'tts_chunk', b64: Buffer.from((result as any).audioData).toString('base64') });
            }
          }
          safeSend({ t: 'tts_end' });
          synthesizer.close();
        });
      } else {
        safeSend({ t: 'tts_end' });
        synthesizer.close();
      }

    } catch (err) {
      console.error('[OpenAI] Completion error:', err);
      safeSend({ t: 'error', message: 'Sorry, I had trouble responding.' });
      synthesizer.close();
    } finally {
      if (fullResponse) {
        await prisma.message.create({
          data: { conversationId, role: 'assistant', text: fullResponse },
        }).catch(e => console.error('[DB] Failed to save assistant message:', e));
      }
      safeSend({ t: 'speak', on: false });
      assistantBusy = false;
      sentenceBuffer = '';
    }
  });

  ws.on('message', (message: Buffer) => {
    if ((deepgramLive as any).getReadyState() === 1) (deepgramLive as any).send(message);
  });

  ws.on('close', () => {
    console.log('[Server] Client disconnected.');
    (deepgramLive as any).finish();
  });

  ws.on('error', (error) => {
    console.error('[Server] WebSocket Error:', error);
    (deepgramLive as any).finish();
  });
});

server.listen(PORT, () => {
  console.log(`🚀 Voice pipeline server listening on :${PORT}`);
});
