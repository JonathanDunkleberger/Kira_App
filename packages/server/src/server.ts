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
  let isAuthenticated = false;

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

  // --- 3. MESSAGE HANDLING (Attached immediately to avoid race conditions) ---
  ws.on("message", (message: Buffer | string, isBinary: boolean) => {
      if (!isAuthenticated) {
          console.log("[WS] Queuing message until auth completes...");
          messageQueue.push({ message, isBinary });
      } else {
          processMessage(message, isBinary);
      }
  });

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
    isAuthenticated = true;
  } catch (err) {
    console.error("[Auth] ❌ Failed:", (err as Error).message);
    ws.close(1008, "Authentication failed");
    return;
  }

  // Re-attach message handler with full logic now that we are auth'd?
  // No, that's messy.
  // Better approach:
  // 1. Define the handler function.
  // 2. Attach it immediately.
  // 3. Inside the handler, if !isAuthenticated, push to a queue.
  // 4. After auth success, process the queue.
  
  const messageQueue: { message: Buffer | string, isBinary: boolean }[] = [];
  
  const processMessage = async (message: Buffer | string, isBinary: boolean) => {
    try {
      // console.log('[WS] Raw message received type:', typeof message, 'isBuffer:', Buffer.isBuffer(message), 'isBinary:', isBinary);

      // --- 3. MESSAGE HANDLING ---
      // Normalize message to string if it's a buffer but meant to be text (control message)
      // or keep as buffer if it's audio.
      
      let controlMessage: any = null;
      
      // Try to parse as JSON first if it's not explicitly binary audio
      if (!isBinary || (Buffer.isBuffer(message) && message.length < 1000)) { // Simple heuristic: short messages might be JSON
          try {
              const text = message.toString();
              if (text.trim().startsWith('{')) {
                  controlMessage = JSON.parse(text);
              }
          } catch (e) {
              // Not JSON, ignore
          }
      }

      if (controlMessage) {
        console.log(`[WS] Received control message: ${JSON.stringify(controlMessage)}`);

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

          if (state !== "listening") {
             console.log(`[WS] EOU ignored: State is '${state}' (not 'listening')`);
             return;
          }
          if (!sttStreamer) {
             console.log(`[WS] EOU ignored: No STT streamer active.`);
             return;
          }
          if (!hasTranscript) {
             console.log(`[WS] EOU ignored: No transcript available yet.`);
             // Optional: Force finalize here to see if we can squeeze out a result?
             // sttStreamer.finalize(); 
             return;
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
      } 
      
      // Handle Binary Audio Data
      if (Buffer.isBuffer(message) && !controlMessage) {
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
  };

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
    
    isAuthenticated = true;
    console.log(`[Auth] Processing ${messageQueue.length} queued messages...`);
    for (const item of messageQueue) {
        await processMessage(item.message, item.isBinary);
    }

  } catch (err) {
    console.error("[Auth] ❌ Failed:", (err as Error).message);
    ws.close(1008, "Authentication failed");
    return;
  }

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
