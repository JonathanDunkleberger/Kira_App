// FILE: packages/socket-server/socket-server.mts
import "dotenv/config";
import { WebSocketServer, WebSocket } from "ws";
import http from "node:http";
import { PrismaClient } from "@prisma/client";
import { createClient } from "@deepgram/sdk";
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
// FIX: Allow overriding the TTS voice via environment variable
const AZURE_TTS_VOICE = process.env.AZURE_TTS_VOICE || "en-US-JennyNeural";

const DEEPGRAM_DISABLED = /^true$/i.test(process.env.DEEPGRAM_DISABLED || "false");
const DEEPGRAM_MODE = (process.env.DEEPGRAM_MODE || "explicit").toLowerCase();
const DEEPGRAM_MODEL = process.env.DEEPGRAM_MODEL || "nova-2";
const DEEPGRAM_ENCODING = process.env.DEEPGRAM_ENCODING || "opus";

// --- SERVICES ---
const prisma = new PrismaClient({
  datasources: {
    db: { url: process.env.DATABASE_URL },
  },
});
const deepgram = createClient(DEEPGRAM_API_KEY);
const openai = new OpenAI({ apiKey: OPENAI_API_KEY });

(async () => {
  try {
    // FIX: Use the correct v3 SDK syntax for project listing
    const { result, error } = await (deepgram as any).manage.getProjects();
    if (error) throw error;
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
  wss.handleUpgrade(req, socket, head, (ws) => {
    wss.emit("connection", ws, req);
  });
});

// Deepgram helper
async function attemptDeepgramLive(label: string, cfg: Record<string, any>, timeoutMs = 4000) {
  return new Promise<{ ok: boolean; conn: any; label: string; error?: any }>((resolve) => {
    let settled = false;
    try {
      const conn = deepgram.listen.live(cfg);
      const timer = setTimeout(() => {
        if (settled) return;
        settled = true;
        try { (conn as any).finish?.(); } catch {}
        resolve({ ok: false, conn, label, error: new Error("timeout") });
      }, timeoutMs);
      conn.on("open", () => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        console.log(`[DG Fallback] ✅ Open using config: ${label}`);
        resolve({ ok: true, conn, label });
      });
      conn.on("error", (e: any) => {
        console.error(`[DG Fallback] ❌ Error on config ${label}:`, e?.message || e, e);
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        resolve({ ok: false, conn, label, error: e });
      });
      conn.on("close", (c: any) => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        resolve({ ok: false, conn, label, error: { code: c?.code, reason: c?.reason } });
      });
    } catch (err) {
      console.error(`[DG Fallback] 🚫 Exception creating config ${label}:`, (err as any)?.message || err);
      resolve({ ok: false, conn: null, label, error: err });
    }
  });
}

async function initDeepgramWithMode() {
  if (DEEPGRAM_DISABLED) {
    console.warn("[DG] Deepgram disabled via DEEPGRAM_DISABLED env var");
    return { mode: "disabled" } as const;
  }
  const DG_MODEL = DEEPGRAM_MODEL;
  const base = { model: DG_MODEL, language: "en-US", smart_format: true, vad_events: true, interim_results: false, utterance_end_ms: 800 };
  const explicit = { ...base, encoding: DEEPGRAM_ENCODING, sample_rate: 48000, channels: 1 };
  const minimal = { ...base };
  const auto = { model: DG_MODEL, language: "en-US" };
  // Reordered: try auto first since it succeeds.
  const attempts: any[] = [];
  attempts.push(await attemptDeepgramLive("auto", auto));
  if (!attempts[attempts.length - 1].ok) attempts.push(await attemptDeepgramLive("explicit", explicit));
  if (!attempts[attempts.length - 1].ok) attempts.push(await attemptDeepgramLive("minimal", minimal));
  return { mode: "fallback", attempts } as const;
}

wss.on("connection", async (ws, req) => {
  let audioChunkCount = 0;
  let totalBytesSent = 0;
  console.log("[Server Log] ✅ New client connected.");
  const conversationId = new URL(req.url!, "http://localhost").searchParams.get("conversationId");
  if (!conversationId) {
    console.warn("[Server Log] Connection closed: Missing conversationId");
    ws.close(1008, "Missing conversationId");
    return;
  }

  const safeSend = (payload: ServerEvent) => {
    if (ws.readyState === WebSocket.OPEN) ws.send(JSON.stringify(payload));
  };

  let deepgramLive: any = null;
  if (!DEEPGRAM_DISABLED) {
    try {
      const primary = await initDeepgramWithMode();
  const successAttempt = (primary as any).attempts?.find((a: any) => a.ok);
      if (successAttempt) {
        console.log(`[DG] Connected with ${successAttempt.label} config`);
        deepgramLive = successAttempt.conn;
      } else {
        throw new Error("All Deepgram connection attempts failed after reordering.");
      }
      deepgramLive.on("open", () => console.log("[DG] Connection opened"));
      deepgramLive.on("close", (c: any) => console.log("[DG] Connection closed", c?.code, c?.reason));
      deepgramLive.on("error", (e: any) => console.error("[DG] Error", e?.message || e, e));
      const ka = setInterval(() => {
        try { if (deepgramLive?.getReadyState?.() === 1) deepgramLive.send(JSON.stringify({ type: "KeepAlive" })); } catch {}
      }, 8000);
      ws.on("close", () => clearInterval(ka));
      ws.on("error", () => clearInterval(ka));
    } catch (err) {
      console.error("[DG] Failed to connect after retries:", (err as any)?.message || err);
      safeSend({ t: "error", message: "Speech recognition unavailable." });
    }
  }

  let assistantBusy = false;
  if (deepgramLive)
    deepgramLive.on("Results", async (data: any) => {
      const transcript = data?.channel?.alternatives?.[0]?.transcript?.trim?.() || "";
      if (!transcript || assistantBusy) return;
      console.log(`[Server Log] Received transcript: "${transcript}"`);
      assistantBusy = true;
      safeSend({ t: "transcript", text: transcript });

      await prisma.message.create({ data: { conversationId, role: "user", text: transcript } }).catch((e) => console.error("[DB] Failed to save user message:", e));
      let fullResponse = "";

      const speechConfig = AzureSpeechSDK.SpeechConfig.fromSubscription(AZURE_SPEECH_KEY, AZURE_SPEECH_REGION);
      speechConfig.speechSynthesisOutputFormat = AzureSpeechSDK.SpeechSynthesisOutputFormat.Webm24Khz16BitMonoOpus;
      speechConfig.speechSynthesisVoiceName = AZURE_TTS_VOICE;
      const synthesizer = new AzureSpeechSDK.SpeechSynthesizer(speechConfig, undefined);

      const synthesizeSentence = (sentence: string): Promise<void> => {
        return new Promise((resolve, reject) => {
          synthesizer.speakTextAsync(
            sentence,
            (result) => {
              if (result.reason === AzureSpeechSDK.ResultReason.SynthesizingAudioCompleted) {
                if ((result as any).audioData) {
                  console.log(`[Server Log] Received audio chunk. Size: ${result.audioData.byteLength}`);
                  safeSend({ t: "tts_chunk", b64: Buffer.from((result as any).audioData).toString("base64") });
                }
                resolve();
              } else {
                console.error(`[Server Log] Azure TTS Error. Reason: ${result.reason}. Details: ${result.errorDetails}`);
                reject(new Error(result.errorDetails));
              }
            },
            (error) => {
              console.error("[Server Log] speakTextAsync error callback:", error);
              reject(error);
            }
          );
        });
      };

      try {
        console.log("[Server Log] Sending transcript to OpenAI...");
        const stream = await openai.chat.completions.create({
          model: "gpt-4o-mini",
            messages: [
            { role: "system", content: "You are Kira, a concise, encouraging AI companion." },
            { role: "user", content: transcript },
          ],
          stream: true,
        });

        let sentenceBuffer = "";
        const sentenceQueue: string[] = [];

        for await (const chunk of stream) {
          const content = (chunk as any).choices[0]?.delta?.content || "";
          if (content) {
            fullResponse += content;
            sentenceBuffer += content;
            safeSend({ t: "assistant_text_chunk", text: content });
            const sentenceEndMatch = sentenceBuffer.match(/[^.!?]+[.!?]+/);
            if (sentenceEndMatch) {
              const sentence = sentenceEndMatch[0];
              sentenceQueue.push(sentence);
              sentenceBuffer = sentenceBuffer.substring(sentence.length);
            }
          }
        }
        if (sentenceBuffer.trim().length > 0) sentenceQueue.push(sentenceBuffer.trim());
        console.log(`[Server Log] OpenAI stream finished. Full response: "${fullResponse}"`);

        if (sentenceQueue.length > 0) {
          safeSend({ t: "speak", on: true });
          safeSend({ t: "tts_start" });
          for (const sentence of sentenceQueue) {
            console.log(`[Server Log] Synthesizing sentence: "${sentence}"`);
            try { await synthesizeSentence(sentence); } catch (e) { console.error("[TTS] Sentence synthesis failed, continuing:", e); }
          }
        }
      } catch (err) {
        console.error("[Server Log] OpenAI/TTS Error:", err);
        safeSend({ t: "error", message: "Sorry, I had trouble responding." });
      } finally {
        safeSend({ t: "tts_end" });
        synthesizer.close();
        if (fullResponse) {
          await prisma.message.create({ data: { conversationId, role: "assistant", text: fullResponse } }).catch((e) => console.error("[DB] Failed to save assistant message:", e));
        }
        safeSend({ t: "speak", on: false });
        assistantBusy = false;
      }
    });

  ws.on("message", (message: Buffer, isBinary) => {
    if (!isBinary || !deepgramLive) return;
    audioChunkCount++;
    totalBytesSent += message.length;
    try {
      if ((deepgramLive as any).getReadyState?.() === 1) (deepgramLive as any).send(message);
    } catch (err) {
      console.error("[DG] send error", (err as any)?.message || err);
    }
  });
  ws.on("close", () => {
    console.log("[Server Log] Client disconnected.");
    try { (deepgramLive as any)?.finish?.(); } catch {}
  });
  ws.on("error", (error) => {
    console.error("[Server Log] WebSocket Error:", error);
    try { (deepgramLive as any)?.finish?.(); } catch {}
  });
});

server.listen(PORT, () => {
  console.log(`🚀 Voice pipeline server listening on :${PORT}`);
});
