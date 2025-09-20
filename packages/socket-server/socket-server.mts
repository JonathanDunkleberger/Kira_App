// FILE: packages/socket-server/socket-server.mts
import "dotenv/config";
import { WebSocketServer, WebSocket } from "ws";
import http from "node:http";
import { PrismaClient } from "@prisma/client";
import { createClient as createDeepgramClient } from "@deepgram/sdk";
import OpenAI from "openai";
import * as AzureSpeechSDK from "microsoft-cognitiveservices-speech-sdk";
import type { ServerEvent } from "./lib/voice-protocol.js";

function requireEnv(name: string): string {
  const value = process.env[name];
  if (!value) {
    console.error(`FATAL: Missing required environment variable "${name}"`);
    process.exit(1);
  }
  return value;
}

// --- CONFIGURATION ---
const DEEPGRAM_API_KEY = requireEnv("DEEPGRAM_API_KEY");
const OPENAI_API_KEY = requireEnv("OPENAI_API_KEY");
const AZURE_SPEECH_KEY = requireEnv("AZURE_SPEECH_KEY");
const AZURE_SPEECH_REGION = requireEnv("AZURE_SPEECH_REGION");
const PORT = parseInt(process.env.PORT || "10000", 10);

// --- SERVICES ---
const prisma = new PrismaClient();
const deepgram = createDeepgramClient(DEEPGRAM_API_KEY);
const openai = new OpenAI({ apiKey: OPENAI_API_KEY });

// =================================================================
// START: ADD THIS DIAGNOSTIC BLOCK
// =================================================================
(async () => {
  try {
    const { result, error } = await deepgram.projects.list();
    if (error) {
      throw error;
    }
    if (result?.projects) {
      console.log(
        "[DG Test] ✅ Deepgram connection test successful. Projects found:",
        result.projects.length
      );
    } else {
      console.warn(
        "[DG Test] 🟡 Deepgram connection test passed, but no projects found."
      );
    }
  } catch (e: any) {
    console.error(
      "[DG Test] ❌ Deepgram connection test FAILED.",
      e?.message || e
    );
  }
})();
// =================================================================
// END: DIAGNOSTIC BLOCK
// =================================================================

// --- HTTP SERVER for Health Checks & WebSocket Upgrades ---
const server = http.createServer((req, res) => {
  if (req.method === "GET" && req.url === "/healthz") {
    res.statusCode = 200;
    res.end("ok");
  } else {
    res.statusCode = 404;
    res.end();
  }
});
const wss = new WebSocketServer({ noServer: true });

server.on("upgrade", (req, socket, head) => {
  const origin = req.headers.origin || "";
  const allowedOrigin = process.env.ALLOWED_ORIGIN;
  const isAllowed =
    process.env.NODE_ENV === "development"
      ? (!!allowedOrigin && origin === allowedOrigin) ||
        origin.startsWith("http://localhost")
      : !!allowedOrigin && origin === allowedOrigin;
  if (!isAllowed) {
    console.warn(
      `[Server] Denying connection from mismatched origin: ${origin}. Expected: ${allowedOrigin}`
    );
    socket.destroy();
    return;
  }
  wss.handleUpgrade(req, socket, head, (ws) => {
    wss.emit("connection", ws, req);
  });
});

// --- WEBSOCKET CONNECTION HANDLING ---
wss.on("connection", async (ws, req) => {
  console.log("[Server Log] ✅ New client connected.");
  const conversationId = new URL(req.url!, "http://localhost").searchParams.get(
    "conversationId"
  );
  if (!conversationId) {
    console.warn("[Server Log] Connection closed: Missing conversationId");
    ws.close(1008, "Missing conversationId");
    return;
  }

  const safeSend = (payload: ServerEvent) => {
    if (ws.readyState === WebSocket.OPEN) ws.send(JSON.stringify(payload));
  };

  const deepgramLive = deepgram.listen.live({
    model: "nova-2",
    language: "en-US",
    smart_format: true,
    vad_events: true,
    interim_results: false,
    utterance_end_ms: 800,
    container: "webm",
    encoding: "opus",
    sample_rate: 48000,
    channels: 1,
  });

  deepgramLive.on("open", () => console.log("[DG] open"));
  deepgramLive.on("metadata", (m: any) =>
    console.log("[DG] metadata", JSON.stringify(m))
  );
  deepgramLive.on("warning", (w: any) => console.warn("[DG] warning", w));
  deepgramLive.on("close", (c: any) =>
    console.log("[DG] close", c?.code, c?.reason)
  );
  deepgramLive.on("error", (e: any) =>
    console.error("[DG] error", e?.message || e)
  );

  let assistantBusy = false;
  let sentenceBuffer = "";

  deepgramLive.on("transcript", async (data) => {
    const transcript = (data as any).channel.alternatives[0].transcript.trim();
    if (!transcript || assistantBusy) return;

    console.log(`[Server Log] Received transcript: "${transcript}"`);
    assistantBusy = true;
    safeSend({ t: "transcript", text: transcript });
    safeSend({ t: "speak", on: true });

    await prisma.message
      .create({
        data: { conversationId, role: "user", text: transcript },
      })
      .catch((e) => console.error("[DB] Failed to save user message:", e));
    let fullResponse = "";

    const speechConfig = AzureSpeechSDK.SpeechConfig.fromSubscription(
      AZURE_SPEECH_KEY,
      AZURE_SPEECH_REGION
    );
    speechConfig.speechSynthesisOutputFormat =
      AzureSpeechSDK.SpeechSynthesisOutputFormat.Webm24Khz16BitMonoOpus;
    speechConfig.speechSynthesisVoiceName = "en-US-JennyNeural";
    const synthesizer = new AzureSpeechSDK.SpeechSynthesizer(
      speechConfig,
      undefined
    );

    try {
      console.log("[Server Log] Sending transcript to OpenAI...");
      const stream = await openai.chat.completions.create({
        model: "gpt-4o-mini",
        messages: [
          {
            role: "system",
            content: "You are Kira, a concise, encouraging AI companion.",
          },
          { role: "user", content: transcript },
        ],
        stream: true,
      });
      safeSend({ t: "tts_start" });

      for await (const chunk of stream) {
        const content = (chunk as any).choices[0]?.delta?.content || "";
        if (content) {
          fullResponse += content;
          sentenceBuffer += content;
          safeSend({ t: "assistant_text_chunk", text: content });

          const sentenceEndMatch = sentenceBuffer.match(/[^.!?]+[.!?]+/);
          if (sentenceEndMatch) {
            const sentence = sentenceEndMatch[0];
            console.log(
              `[Server Log] Sending sentence to Azure TTS: "${sentence}"`
            );
            sentenceBuffer = sentenceBuffer.substring(sentence.length);

            synthesizer.speakTextAsync(sentence, (result) => {
              if (
                result.reason ===
                AzureSpeechSDK.ResultReason.SynthesizingAudioCompleted
              ) {
                if ((result as any).audioData) {
                  console.log(
                    `[Server Log] Received audio chunk from Azure. Size: ${result.audioData.byteLength}`
                  );
                  safeSend({
                    t: "tts_chunk",
                    b64: Buffer.from((result as any).audioData).toString(
                      "base64"
                    ),
                  });
                }
              }
            });
          }
        }
      }
      console.log(
        `[Server Log] OpenAI stream finished. Full response: "${fullResponse}"`
      );

      if (sentenceBuffer.trim().length > 0) {
        console.log(
          `[Server Log] Sending final sentence fragment to Azure TTS: "${sentenceBuffer.trim()}"`
        );
        synthesizer.speakTextAsync(sentenceBuffer.trim(), (result) => {
          if (
            result.reason ===
            AzureSpeechSDK.ResultReason.SynthesizingAudioCompleted
          ) {
            if ((result as any).audioData) {
              console.log(
                `[Server Log] Received final audio chunk from Azure. Size: ${result.audioData.byteLength}`
              );
              safeSend({
                t: "tts_chunk",
                b64: Buffer.from((result as any).audioData).toString("base64"),
              });
            }
          }
          safeSend({ t: "tts_end" });
          synthesizer.close();
        });
      } else {
        safeSend({ t: "tts_end" });
        synthesizer.close();
      }
    } catch (err) {
      console.error("[Server Log] OpenAI/TTS Error:", err);
      safeSend({ t: "error", message: "Sorry, I had trouble responding." });
      synthesizer.close();
    } finally {
      if (fullResponse) {
        await prisma.message
          .create({
            data: { conversationId, role: "assistant", text: fullResponse },
          })
          .catch((e) =>
            console.error("[DB] Failed to save assistant message:", e)
          );
      }
      safeSend({ t: "speak", on: false });
      assistantBusy = false;
      sentenceBuffer = "";
    }
  });

  ws.on("message", (message: Buffer, isBinary) => {
    if (!isBinary) return;
    if ((deepgramLive as any).getReadyState?.() === 1) {
      (deepgramLive as any).send(message);
    }
  });
  ws.on("close", () => {
    console.log("[Server Log] Client disconnected.");
    (deepgramLive as any).finish();
  });
  ws.on("error", (error) => {
    console.error("[Server Log] WebSocket Error:", error);
    (deepgramLive as any).finish();
  });
});
server.listen(PORT, () => {
  console.log(`🚀 Voice pipeline server listening on :${PORT}`);
});
