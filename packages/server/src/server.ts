import { WebSocketServer } from "ws";
import type { IncomingMessage } from "http";
import { createServer } from "http";
import { URL } from "url";
import { PrismaClient } from "@prisma/client";
import { createClerkClient, verifyToken } from "@clerk/backend";
import { OpenAI } from "openai";
import { DeepgramSTTStreamer } from "./DeepgramSTTStreamer.js";
import { AzureTTSStreamer } from "./AzureTTSStreamer.js";

// --- CONFIGURATION ---
const PORT = process.env.PORT ? parseInt(process.env.PORT, 10) : 10000;
const CLERK_SECRET_KEY = process.env.CLERK_SECRET_KEY!;
const OPENAI_API_KEY = process.env.OPENAI_API_KEY!;

const clerkClient = createClerkClient({ secretKey: CLERK_SECRET_KEY });
const prisma = new PrismaClient();
const openai = new OpenAI({ apiKey: OPENAI_API_KEY });

const server = createServer();
const wss = new WebSocketServer({ server });

console.log("[Server] Starting...");
console.log("[Config] PORT:", PORT);
console.log("[Config] CLERK_SECRET_KEY:", CLERK_SECRET_KEY ? "Set" : "Missing");
console.log("[Config] OPENAI_API_KEY:", OPENAI_API_KEY ? "Set" : "Missing");
console.log("[Config] DEEPGRAM_API_KEY:", process.env.DEEPGRAM_API_KEY ? "Set" : "Missing");
console.log("[Config] AZURE_SPEECH_KEY:", process.env.AZURE_SPEECH_KEY ? "Set" : "Missing");

wss.on("connection", async (ws: any, req: IncomingMessage) => {
  console.log("[WS] New client connecting...");
  const url = new URL(req.url!, `wss://${req.headers.host}`);
  const token = url.searchParams.get("token");
  const guestId = url.searchParams.get("guestId");

  let userId: string | null = null;
  // TODO: Add your free trial timer logic here
  // let timer = FREE_TRIAL_SECONDS;

  // --- 1. AUTH & USER SETUP ---
  try {
    if (token) {
      const payload = await verifyToken(token, { secretKey: CLERK_SECRET_KEY });
      if (!payload?.sub) {
        throw new Error("Unable to resolve user id from token");
      }
      userId = payload.sub;
      console.log(`[Auth] ✅ Authenticated user: ${userId}`);
    } else if (guestId) {
      userId = `guest_${guestId}`;
      console.log(`[Auth] - Guest user: ${userId}`);
    } else {
      throw new Error("No auth provided.");
    }
  } catch (err) {
    console.error("[Auth] ❌ Failed:", (err as Error).message);
    ws.close(1008, "Authentication failed");
    return;
  }

  // --- 2. PIPELINE SETUP ---
  let state = "listening";
  let sttStreamer: DeepgramSTTStreamer | null = null;
  let currentTurnTranscript = "";
  let latestInterimTranscript = "";
  const chatHistory: OpenAI.Chat.ChatCompletionMessageParam[] = [
    {
      role: "system",
      content:
        "You are Kira, a helpful AI companion. You are a 'ramble bot', so you listen patiently. Your responses are friendly, concise, and conversational. You never interrupt.",
    },
  ];

  ws.on("message", async (message: Buffer | string) => {
    try {
      // --- 3. MESSAGE HANDLING ---
      if (typeof message === "string") {
        console.log(`[WS] Received string message: ${message.slice(0, 50)}...`);
        const controlMessage = JSON.parse(message);

        if (controlMessage.type === "start_stream") {
          console.log("[WS] Received start_stream. Initializing pipeline...");
          try {
            sttStreamer = new DeepgramSTTStreamer();
            await sttStreamer.start();

            sttStreamer.on(
              "transcript",
              (transcript: string, isFinal: boolean) => {
                if (isFinal) {
                  currentTurnTranscript += transcript + " ";
                  latestInterimTranscript = "";
                } else {
                  latestInterimTranscript = transcript;
                }
                // Send transcript to client for UI
                ws.send(
                  JSON.stringify({
                    type: "transcript",
                    role: "user",
                    text: isFinal ? currentTurnTranscript : currentTurnTranscript + transcript,
                    isFinal,
                  })
                );
              }
            );

            sttStreamer.on("error", (err: Error) => {
              console.error("[Pipeline] ❌ STT Error:", err.message);
              state = "listening"; // Reset
            });

            ws.send(JSON.stringify({ type: "stream_ready" }));
          } catch (err) {
            console.error("[Pipeline] ❌ Failed to start STT:", err);
          }
        } else if (controlMessage.type === "eou") {
          // Check if we have a final transcript OR an interim one
          const hasTranscript =
            currentTurnTranscript.trim().length > 0 ||
            latestInterimTranscript.trim().length > 0;

          if (state !== "listening" || !sttStreamer || !hasTranscript) {
            return; // Already thinking or nothing was said
          }

          state = "thinking";
          sttStreamer.finalize();

          // Construct the full user message
          let userMessage = currentTurnTranscript.trim();
          if (latestInterimTranscript.trim().length > 0) {
            userMessage += " " + latestInterimTranscript.trim();
          }
          userMessage = userMessage.trim();

          currentTurnTranscript = ""; // Reset for next turn
          latestInterimTranscript = ""; // Reset for next turn

          console.log(`[USER TRANSCRIPT]: "${userMessage}"`);
          console.log(`[LLM] Sending to OpenAI: "${userMessage}"`);
          ws.send(JSON.stringify({ type: "state_thinking" }));
          chatHistory.push({ role: "user", content: userMessage });

          let llmResponse = "I'm not sure what to say.";
          try {
            const chatCompletion = await openai.chat.completions.create({
              model: "gpt-4o-mini",
              messages: chatHistory,
            });
            llmResponse =
              chatCompletion.choices[0]?.message?.content || llmResponse;
            chatHistory.push({ role: "assistant", content: llmResponse });
          } catch (err) {
            console.error(
              "[Pipeline] ❌ OpenAI Error:",
              (err as Error).message
            );
          }

          console.log(`[AI RESPONSE]: "${llmResponse}"`);
          console.log(`[LLM] Received from OpenAI: "${llmResponse}"`);
          
          // Send AI transcript to client
          ws.send(
            JSON.stringify({
              type: "transcript",
              role: "ai",
              text: llmResponse,
              isFinal: true,
            })
          );

          state = "speaking";
          ws.send(JSON.stringify({ type: "state_speaking" }));

          // --- Real Azure TTS Integration ---
          console.log("[TTS] Sending to Azure...");
          const ttsStreamer = new AzureTTSStreamer();
          ws.send(JSON.stringify({ type: "tts_chunk_starts" }));

          ttsStreamer.on("audio_chunk", (chunk: Buffer) => ws.send(chunk));
          ttsStreamer.on("tts_complete", () => {
            ws.send(JSON.stringify({ type: "tts_chunk_ends" }));
            state = "listening";
            ws.send(JSON.stringify({ type: "state_listening" }));
          });
          ttsStreamer.on("error", (err: Error) => {
            console.error("[Pipeline] ❌ TTS Error:", err);
            state = "listening";
            ws.send(JSON.stringify({ type: "state_listening" }));
          });

          ttsStreamer.synthesize(llmResponse);
        }
      } else if (message instanceof Buffer) {
        if (state === "listening" && sttStreamer) {
          // Log occasional audio packet to prove we are receiving data
          if (Math.random() < 0.01) {
             console.log(`[WS] 🎤 Received audio chunk (${message.byteLength} bytes)`);
          }
          sttStreamer.write(message); // Forward raw audio to Deepgram
        }
      }
    } catch (err) {
      console.error(
        "[FATAL] MESSAGE HANDLER CRASHED:",
        (err as Error).message
      );
      console.error((err as Error).stack);
      if (ws.readyState === (ws as any).OPEN) {
        ws.send(JSON.stringify({ type: "error", message: "Internal server error" }));
        ws.close(1011, "Internal server error");
      }
    }
  });

  ws.on("close", (code: number) => {
    console.log(`[WS] Client disconnected. Code: ${code}`);
    if (sttStreamer) sttStreamer.destroy();
  });
  ws.on("error", (err: Error) => {
    console.error("[WS] WebSocket error:", err);
    if (sttStreamer) sttStreamer.destroy();
  });
});

// --- START THE SERVER ---
server.listen(PORT, () => {
  console.log(`🚀 Voice pipeline server listening on :${PORT}`);
});
