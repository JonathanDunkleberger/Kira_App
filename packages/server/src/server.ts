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

wss.on("connection", (ws: any, req: IncomingMessage) => {
  console.log("[WS] New client connecting...");
  const url = new URL(req.url!, `wss://${req.headers.host}`);
  const token = url.searchParams.get("token");
  const guestId = url.searchParams.get("guestId");

  let userId: string | null = null;
  
  // --- 1. AUTH & USER SETUP (Async, but non-blocking for listener attachment) ---
  // const authPromise = (async () => {
  //   try {
  //     if (token) {
  //       const payload = await verifyToken(token, { secretKey: CLERK_SECRET_KEY });
  //       if (!payload?.sub) {
  //         throw new Error("Unable to resolve user id from token");
  //       }
  //       userId = payload.sub;
  //       console.log(`[Auth] ✅ Authenticated user: ${userId}`);
  //       return true;
  //     } else if (guestId) {
  //       userId = `guest_${guestId}`;
  //       console.log(`[Auth] - Guest user: ${userId}`);
  //       return true;
  //     } else {
  //       throw new Error("No auth provided.");
  //     }
  //   } catch (err) {
  //     console.error("[Auth] ❌ Failed:", (err as Error).message);
  //     ws.close(1008, "Authentication failed");
  //     return false;
  //   }
  // })();

  // --- 2. PIPELINE SETUP ---
  let state = "listening";
  let sttStreamer: DeepgramSTTStreamer | null = null;
  let currentTurnTranscript = "";
  let latestImages: string[] | null = null;
  let lastImageTimestamp = 0;

  const chatHistory: OpenAI.Chat.ChatCompletionMessageParam[] = [
    {
      role: "system",
      content:
        "You are Kira, a helpful AI companion. You are a 'ramble bot', so you listen patiently. Your responses are friendly, concise, and conversational. You never interrupt. You can see the user's screen if they share it. If they ask if you can see their screen, say yes and describe what you see.\n\n[TECHNICAL NOTE: VISUAL INPUT]\nWhen the user shares their screen, you may receive a sequence of images instead of a single snapshot. These images represent a timeline of events leading up to the current moment. The LAST image in the sequence is the current moment. The previous images are context (e.g., previous scenes in a video). Use this sequence to understand what is happening over time, but focus your response on the current moment unless the user asks about the past.",
    },
  ];

  ws.on("message", async (message: Buffer, isBinary: boolean) => {
    // Wait for auth to complete before processing ANY message
    // const isAuthenticated = await authPromise;
    // if (!isAuthenticated) return; 

    try {
      // --- 3. MESSAGE HANDLING ---
      // In ws v8+, message is a Buffer. We need to check if it's a JSON control message.
      let controlMessage: any = null;
      
      // Try to parse as JSON if it looks like text
      try {
        const str = message.toString();
        if (str.trim().startsWith("{")) {
          controlMessage = JSON.parse(str);
        }
      } catch (e) {
        // Not JSON, treat as binary audio
      }

      if (controlMessage) {
        console.log(`[WS] Control message: ${controlMessage.type}`);
        if (controlMessage.type === "start_stream") {
          console.log("[WS] Received start_stream. Initializing pipeline...");
          sttStreamer = new DeepgramSTTStreamer();
          await sttStreamer.start();

          sttStreamer.on(
            "transcript",
            (transcript: string, isFinal: boolean) => {
              if (isFinal) currentTurnTranscript += transcript + " ";
              // Send transcript to client for real-time display
              ws.send(JSON.stringify({ 
                type: "transcript", 
                role: "user", 
                text: currentTurnTranscript.trim() || transcript 
              }));
            }
          );

          sttStreamer.on("error", (err: Error) => {
            console.error("[Pipeline] ❌ STT Error:", err.message);
            state = "listening"; // Reset
          });

          ws.send(JSON.stringify({ type: "stream_ready" }));
        } else if (controlMessage.type === "eou") {
          if (
            state !== "listening" ||
            !sttStreamer ||
            currentTurnTranscript.trim().length === 0
          ) {
            return; // Already thinking or nothing was said
          }

          state = "thinking";
          // sttStreamer.finalize(); // Don't close the STT stream, just pause processing
          const userMessage = currentTurnTranscript.trim();
          currentTurnTranscript = ""; // Reset for next turn

          console.log(`[USER TRANSCRIPT]: "${userMessage}"`);
          console.log(`[LLM] Sending to OpenAI: "${userMessage}"`);
          ws.send(JSON.stringify({ type: "state_thinking" }));

          // Check if we have a recent image (within last 10 seconds)
          const now = Date.now();
          if (latestImages && latestImages.length > 0 && (now - lastImageTimestamp < 10000)) {
            console.log(`[Vision] Attaching ${latestImages.length} images to user message.`);
            
            const content: OpenAI.Chat.ChatCompletionContentPart[] = [
                { type: "text", text: userMessage }
            ];

            latestImages.forEach((img) => {
                content.push({
                    type: "image_url",
                    image_url: {
                        url: img,
                        detail: "low"
                    }
                });
            });

            chatHistory.push({
              role: "user",
              content: content,
            });
            
            latestImages = null; 
          } else {
            chatHistory.push({ role: "user", content: userMessage });
          }

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
          ws.send(JSON.stringify({ 
            type: "transcript", 
            role: "ai", 
            text: llmResponse 
          }));

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
        } else if (controlMessage.type === "image") {
          // Handle incoming image snapshot
          // Support both single 'image' (legacy/fallback) and 'images' array
          if (controlMessage.images && Array.isArray(controlMessage.images)) {
             console.log(`[Vision] Received ${controlMessage.images.length} images. Updating buffer.`);
             latestImages = controlMessage.images;
             lastImageTimestamp = Date.now();
          } else if (controlMessage.image) {
            console.log("[Vision] Received single image snapshot. Updating buffer.");
            latestImages = [controlMessage.image];
            lastImageTimestamp = Date.now();
          }
        }
      } else if (message instanceof Buffer) {
        if (state === "listening" && sttStreamer) {
          sttStreamer.write(message); // Forward raw audio to Google
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
