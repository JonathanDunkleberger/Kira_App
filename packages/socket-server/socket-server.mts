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
const DEEPGRAM_DISABLED = /^true$/i.test(
  process.env.DEEPGRAM_DISABLED || "false"
);
// Modes: explicit (current explicit params), minimal (remove container/encoding/sample_rate/channels), auto (let SDK infer), fallback (try explicit -> minimal -> auto)
const DEEPGRAM_MODE = (process.env.DEEPGRAM_MODE || "explicit").toLowerCase();

// --- SERVICES ---
const prisma = new PrismaClient();
const deepgram = createClient(DEEPGRAM_API_KEY);
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
// Helper to create a Deepgram live connection with a given config object.
async function attemptDeepgramLive(
  label: string,
  cfg: Record<string, any>,
  timeoutMs = 4000
) {
  return new Promise<{ ok: boolean; conn: any; label: string; error?: any }>(
    (resolve) => {
      let settled = false;
      try {
        const conn = deepgram.listen.live(cfg);
        const timer = setTimeout(() => {
          if (settled) return;
          settled = true;
          try {
            (conn as any).finish?.();
          } catch {}
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
          console.error(
            `[DG Fallback] ❌ Error on config ${label}:`,
            e?.message || e,
            e
          );
          if (settled) return;
          settled = true;
          clearTimeout(timer);
          resolve({ ok: false, conn, label, error: e });
        });
        conn.on("close", (c: any) => {
          if (settled) return; // treat early close as failure
          settled = true;
          clearTimeout(timer);
          resolve({
            ok: false,
            conn,
            label,
            error: { code: c?.code, reason: c?.reason },
          });
        });
      } catch (err) {
        console.error(
          `[DG Fallback] 🚫 Exception creating config ${label}:`,
          (err as any)?.message || err
        );
        resolve({ ok: false, conn: null, label, error: err });
      }
    }
  );
}

async function initDeepgramWithMode() {
  if (DEEPGRAM_DISABLED) {
    console.warn("[DG] Deepgram disabled via DEEPGRAM_DISABLED env var");
    return { mode: "disabled" } as const;
  }
  const base = {
    model: "nova-2",
    language: "en-US",
    smart_format: true,
    vad_events: true,
    interim_results: false,
    utterance_end_ms: 800,
  };
  const explicit = {
    ...base,
    container: "webm",
    encoding: "opus",
    sample_rate: 48000,
    channels: 1,
  };
  const minimal = { ...base }; // rely on Deepgram defaults for container/encoding
  const auto = { model: "nova-2", language: "en-US" };

  if (DEEPGRAM_MODE === "explicit") {
    return {
      mode: "explicit",
      attempts: [await attemptDeepgramLive("explicit", explicit)],
    } as const;
  }
  if (DEEPGRAM_MODE === "minimal") {
    return {
      mode: "minimal",
      attempts: [await attemptDeepgramLive("minimal", minimal)],
    } as const;
  }
  if (DEEPGRAM_MODE === "auto") {
    return {
      mode: "auto",
      attempts: [await attemptDeepgramLive("auto", auto)],
    } as const;
  }
  // fallback mode
  const attempts = [] as any[];
  attempts.push(await attemptDeepgramLive("explicit", explicit));
  if (!attempts[attempts.length - 1].ok)
    attempts.push(await attemptDeepgramLive("minimal", minimal));
  if (!attempts[attempts.length - 1].ok)
    attempts.push(await attemptDeepgramLive("auto", auto));
  return { mode: "fallback", attempts } as const;
}

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

  const dgInit = await initDeepgramWithMode();
  let deepgramLive: any = null;
  if (dgInit.mode === "disabled") {
    console.warn("[DG] STT disabled; transcripts will not be generated.");
  } else {
    const successAttempt = dgInit.attempts.find((a: any) => a.ok);
    if (successAttempt) {
      deepgramLive = successAttempt.conn;
      console.log(
        `[DG] Using config '${successAttempt.label}'. Attempts summary: ${dgInit.attempts
          .map((a: any) => `${a.label}:${a.ok ? "ok" : "fail"}`)
          .join(",")}`
      );
      deepgramLive.on("metadata", (m: any) =>
        console.log("[DG] metadata", JSON.stringify(m))
      );
      deepgramLive.on("warning", (w: any) => console.warn("[DG] warning", w));
      deepgramLive.on("close", (c: any) =>
        console.log("[DG] close", c?.code, c?.reason)
      );
      deepgramLive.on("error", (e: any) =>
        console.error("[DG] error", e?.message || e, e)
      );
    } else {
      console.error(
        `[DG] All Deepgram attempts failed (mode=${dgInit.mode}). Details:`,
        dgInit.attempts.map((a: any) => ({
          label: a.label,
          error: a.error?.message || a.error,
        }))
      );
      safeSend({ t: "error", message: "Speech recognition unavailable." });
    }
  }

  let assistantBusy = false;
  let sentenceBuffer = "";

  if (deepgramLive)
    deepgramLive.on("transcript", async (data: any) => {
      const transcript = (
        data as any
      ).channel.alternatives[0].transcript.trim();
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
                  b64: Buffer.from((result as any).audioData).toString(
                    "base64"
                  ),
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
    if (!deepgramLive) return; // disabled or failed
    try {
      const ready = (deepgramLive as any).getReadyState?.();
      if (ready === 1) (deepgramLive as any).send(message);
    } catch (err) {
      console.error("[DG] send error", (err as any)?.message || err);
    }
  });
  ws.on("close", () => {
    console.log("[Server Log] Client disconnected.");
    try {
      (deepgramLive as any)?.finish?.();
    } catch {}
  });
  ws.on("error", (error) => {
    console.error("[Server Log] WebSocket Error:", error);
    try {
      (deepgramLive as any)?.finish?.();
    } catch {}
  });
});
server.listen(PORT, () => {
  console.log(`🚀 Voice pipeline server listening on :${PORT}`);
});
