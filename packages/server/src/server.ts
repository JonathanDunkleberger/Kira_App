import { WebSocketServer } from "ws";
import type { IncomingMessage } from "http";
import { createServer } from "http";
import { URL } from "url";
import { PrismaClient } from "@prisma/client";
import { createClerkClient, verifyToken } from "@clerk/backend";
import { OpenAI } from "openai";
import { DeepgramSTTStreamer } from "./DeepgramSTTStreamer.js";
import { AzureTTSStreamer } from "./AzureTTSStreamer.js";

// Global fatal handlers MUST be defined before server creation
process.on("unhandledRejection", (r) => console.error("[FATAL] UnhandledRejection:", r));
process.on("uncaughtException", (e) => console.error("[FATAL] UncaughtException:", e));

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

wss.on("connection", async (ws: any, req: IncomingMessage) => {
  console.log("[WS] New client connecting...");
  const url = new URL(req.url!, `http://${req.headers.host}`); // scheme doesn't matter for parsing
  const token = url.searchParams.get("token");
  const guestId = url.searchParams.get("guestId");

  let userId: string | null = null;
  try {
    if (token) {
      const payload = await verifyToken(token, { secretKey: CLERK_SECRET_KEY });
      if (!payload?.sub) throw new Error("Unable to resolve user id from token");
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
    try { ws.close(1008, "Authentication failed"); } catch {}
    return;
  }

  let state: "listening" | "thinking" | "speaking" = "listening";
  let sttStreamer: DeepgramSTTStreamer | null = null;
  let currentTurnTranscript = "";
  const chatHistory: OpenAI.Chat.ChatCompletionMessageParam[] = [
    {
      role: "system",
      content:
        "You are Kira, a helpful AI companion. You are a 'ramble bot', so you listen patiently. Your responses are friendly, concise, and conversational. You never interrupt.",
    },
  ];

  ws.on("message", async (data: Buffer, isBinary: boolean) => {
    try {
      if (isBinary) {
        if (state === "listening" && sttStreamer) {
          try {
            sttStreamer.write(data);
          } catch (err) {
            console.error("[WS] Audio write failed:", err);
          }
        } else {
          console.log("[WS] Dropping audio chunk (state:", state, ")");
        }
        return;
      }

      // Text control message
      const text = typeof data === "string" ? (data as unknown as string) : data.toString("utf8");
      console.log("[WS] Control frame:", text);
      let controlMessage: any;
      try {
        controlMessage = JSON.parse(text);
      } catch (e) {
        console.error("[CTRL] Non-JSON control message:", e);
        return;
      }

      if (controlMessage.type === "start_stream") {
        console.log("[WS] Received start_stream. Initializing pipeline...");
        sttStreamer = new DeepgramSTTStreamer();

        // LISTENERS MUST BE ATTACHED BEFORE AWAIT start()
        sttStreamer.on("transcript", (transcript: string, isFinal: boolean) => {
          if (isFinal) currentTurnTranscript += transcript + " ";
        });
        sttStreamer.on("error", (err: Error) => {
          console.error("[Pipeline] ❌ STT Error:", err?.message || err);
          state = "listening";
        });

        // If DEEPGRAM_API_KEY is missing/invalid, this await will REJECT and fall into catch
        await sttStreamer.start();
        console.log("[STT] Deepgram connection OPEN");
        ws.send(JSON.stringify({ type: "stream_ready" }));
        return;
      }

      if (controlMessage.type === "eou") {
        if (state !== "listening" || !sttStreamer || currentTurnTranscript.trim().length === 0) {
          return;
        }

        state = "thinking";
        sttStreamer.finalize();
        const userMessage = currentTurnTranscript.trim();
        currentTurnTranscript = "";
        console.log(`[USER TRANSCRIPT]: "${userMessage}"`);
        ws.send(JSON.stringify({ type: "state_thinking" }));
        chatHistory.push({ role: "user", content: userMessage });

        let llmResponse = "I'm not sure what to say.";
        try {
          const chatCompletion = await openai.chat.completions.create({
            model: "gpt-4o-mini",
            messages: chatHistory,
          });
          llmResponse = chatCompletion.choices[0]?.message?.content || llmResponse;
          chatHistory.push({ role: "assistant", content: llmResponse });
        } catch (err) {
          console.error("[Pipeline] ❌ OpenAI Error:", (err as Error).message);
        }

        console.log(`[AI RESPONSE]: "${llmResponse}"`);
        state = "speaking";
        ws.send(JSON.stringify({ type: "state_speaking" }));

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
        return;
      }

      // Unknown control type -> ignore
    } catch (err) {
      console.error("[FATAL] MESSAGE HANDLER CRASHED:", err);
      try { ws.close(1011, "Internal error"); } catch {}
    }
  });

  ws.on("close", (code: number) => {
    console.log(`[WS] Client disconnected. Code: ${code}`);
    try { sttStreamer?.destroy(); } catch {}
  });
  ws.on("error", (err: Error) => {
    console.error("[WS] WebSocket error:", err);
    try { sttStreamer?.destroy(); } catch {}
  });
});

// --- START THE SERVER ---
server.listen(PORT, () => {
  console.log(`🚀 Voice pipeline server listening on :${PORT}`);
});
