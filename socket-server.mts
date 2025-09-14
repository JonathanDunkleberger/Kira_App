import { WebSocketServer, WebSocket } from 'ws';
import { PrismaClient } from '@prisma/client';
import { Deepgram } from '@deepgram/sdk';
import OpenAI from 'openai';
import * as AzureSpeechSDK from 'microsoft-cognitiveservices-speech-sdk';

// --- Environment Variable Validation ---
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

// --- Clients ---
const prisma = new PrismaClient();
const deepgram = new Deepgram(DEEPGRAM_API_KEY);
const openai = new OpenAI({ apiKey: OPENAI_API_KEY });

// --- Main Server Logic ---
const wss = new WebSocketServer({ port: 10000 });
console.log('Voice pipeline server listening on port 10000');

wss.on('connection', async (ws, req) => {
  console.log('[Server] ✅ New client connected.');
  let conversationId: string | null = null;
  let userId: string | null = null;
  let isGuest = true;
  
  const deepgramLive = deepgram.transcription.live({
      smart_format: true,
      model: 'nova-2',
      language: 'en-US',
  });

  deepgramLive.addListener('transcriptReceived', async (data: any) => {
      const transcript = JSON.parse(data).channel.alternatives[0].transcript;
      if (transcript) {
          console.log('[STT]', transcript);
          // TODO: Implement logic to process final transcript
      }
  });

  ws.on('message', async (message) => {
    if (typeof message === 'string') {
        const event = JSON.parse(message);
        if (event.type === 'client_ready') {
            conversationId = event.conversationId;
            userId = event.userId; // Will be null for guests
            isGuest = !userId;

            try {
                // Ensure conversation exists
                const conversation = await prisma.conversation.findUnique({ where: { id: conversationId! }});
                if (!conversation) {
                    await prisma.conversation.create({
                        data: {
                            id: conversationId!,
                            userId: userId || undefined,
                            isGuest: isGuest,
                        }
                    });
                }
                console.log(`[Server] Client ready for conversation: ${conversationId}`);
            } catch (error) {
                console.error('[Server] DB Error on connection:', error);
                ws.close(1011, 'Database error during session creation.');
            }
        }
    } else if (message instanceof Buffer) {
        deepgramLive.send(message);
    }
  });

  ws.on('close', () => {
    console.log('[Server] ❌ Client disconnected.');
    deepgramLive.finish();
  });

  ws.on('error', (error) => {
    console.error('[Server] WebSocket Error:', error);
    deepgramLive.finish();
  });
});
