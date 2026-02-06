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
const OPENAI_MODEL = process.env.OPENAI_MODEL || "gpt-4o-mini";

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

  // --- KEEP-ALIVE HEARTBEAT ---
  // Send a ping every 30 seconds to prevent load balancer timeouts (e.g. Render, Nginx)
  const keepAliveInterval = setInterval(() => {
    if (ws.readyState === ws.OPEN) {
      ws.send(JSON.stringify({ type: "ping" }));
    }
  }, 30000);

  let userId: string | null = null;  // --- 1. AUTH & USER SETUP (Async, but non-blocking for listener attachment) ---
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
  let viewingContext = ""; // Track the current media context
  let lastEouTime = 0;
  const EOU_DEBOUNCE_MS = 600; // Ignore EOU if within 600ms of last one

  const tools: OpenAI.Chat.ChatCompletionTool[] = [
    {
      type: "function",
      function: {
        name: "update_viewing_context",
        description: "Updates the current media or activity context that the user is watching or doing. Call this when the user mentions watching a specific movie, show, or playing a game.",
        parameters: {
          type: "object",
          properties: {
            context: {
              type: "string",
              description: "The name of the media or activity (e.g., 'Berserk 1997', 'The Office', 'Coding').",
            },
          },
          required: ["context"],
        },
      },
    },
  ];

  const chatHistory: OpenAI.Chat.ChatCompletionMessageParam[] = [
    {
      role: "system",
      content:
        "You are Kira, a helpful AI companion. You are a 'ramble bot', so you listen patiently. Your responses are friendly, concise, and conversational. You never interrupt. You can see the user's screen if they share it.\n\n[VISUAL BEHAVIOR]\nUse the visual input to understand the context, but DO NOT describe the scene unless explicitly asked. If the user asks a question unrelated to the screen (e.g., about esports), answer it directly without mentioning the screen. Only comment on the visual content if the user's prompt implies they are talking about it.\n\n[TECHNICAL NOTE: VISUAL INPUT]\nWhen the user shares their screen, you may receive a sequence of images instead of a single snapshot. These images represent a timeline of events leading up to the current moment. The LAST image in the sequence is the current moment. The previous images are context (e.g., previous scenes in a video). Use this sequence to understand what is happening over time. IMPORTANT: Do NOT mention 'images', 'frames', or 'sequence' in your response. Speak naturally as if you are watching the video alongside the user.\n\n[CHARACTER IDENTIFICATION]\nWhen a media context is active (e.g., a movie, anime, or game), you are expected to identify the fictional characters visible on screen. Do not be vague. If you see a character that looks like Guts from Berserk and the context is Berserk, call him Guts. If you are unsure, make an educated guess based on the context. Do not refuse to identify fictional characters.\n\n[CONTEXT MANAGEMENT]\nIf the user mentions what they are watching or doing, use the 'update_viewing_context' tool to set the context. This helps you understand the images better.",
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
          // Debounce: ignore EOU if one was just processed
          const now = Date.now();
          if (now - lastEouTime < EOU_DEBOUNCE_MS) {
            console.log(`[EOU] Ignoring spurious EOU (debounced, ${now - lastEouTime}ms since last)`);
            return;
          }

          if (
            state !== "listening" ||
            !sttStreamer ||
            currentTurnTranscript.trim().length === 0
          ) {
            return; // Already thinking or nothing was said
          }

          state = "thinking";
          lastEouTime = now; // Record this EOU time for debouncing
          // sttStreamer.finalize(); // Don't close the STT stream, just pause processing
          const userMessage = currentTurnTranscript.trim();
          currentTurnTranscript = ""; // Reset for next turn

          console.log(`[USER TRANSCRIPT]: "${userMessage}"`);
          console.log(`[LLM] Sending to OpenAI: "${userMessage}"`);
          ws.send(JSON.stringify({ type: "state_thinking" }));

          // Check if we have a recent image (within last 10 seconds)
          const imageCheckTime = Date.now();
          if (latestImages && latestImages.length > 0 && (imageCheckTime - lastImageTimestamp < 10000)) {
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

          // --- CONTEXT MANAGEMENT (Sliding Window) ---
          // Keep System Prompt (index 0) + Last 10 messages to stay under TPM limit
          const MAX_HISTORY = 10; 
          if (chatHistory.length > MAX_HISTORY + 1) {
             const elementsToRemove = chatHistory.length - (MAX_HISTORY + 1);
             chatHistory.splice(1, elementsToRemove);
             console.log(`[Context] Pruned history to last ${MAX_HISTORY} messages to save tokens.`);
          }

          let llmResponse = "";
          try {
            // Step 1: Check for tool calls with a non-streaming request
            const initialCompletion = await openai.chat.completions.create({
              model: OPENAI_MODEL,
              messages: chatHistory,
              tools: tools,
              tool_choice: "auto",
            });

            const initialMessage = initialCompletion.choices[0]?.message;

            if (initialMessage?.tool_calls) {
              // Handle tool calls (existing logic)
              chatHistory.push(initialMessage);
              for (const toolCall of initialMessage.tool_calls) {
                if (toolCall.function.name === "update_viewing_context") {
                  const args = JSON.parse(toolCall.function.arguments);
                  viewingContext = args.context;
                  console.log(`[Context] Updated viewing context to: "${viewingContext}"`);
                  const systemMsg = chatHistory[0] as OpenAI.Chat.ChatCompletionSystemMessageParam;
                  if (systemMsg) {
                    let content = systemMsg.content as string;
                    const contextMarker = "\n\n[CURRENT CONTEXT]:";
                    if (content.includes(contextMarker)) {
                      content = content.split(contextMarker)[0];
                    }
                    systemMsg.content = content + `${contextMarker} ${viewingContext}`;
                  }
                  chatHistory.push({
                    role: "tool",
                    tool_call_id: toolCall.id,
                    content: `Context updated to: ${viewingContext}`,
                  });
                }
              }
            } else if (initialMessage && !initialMessage.tool_calls) {
              // No tool calls on first try — use this response directly
              // (skip the streaming call since we already have the answer)
              llmResponse = initialMessage.content || "";
              chatHistory.push({ role: "assistant", content: llmResponse });

              console.log(`[AI RESPONSE]: "${llmResponse}"`);
              ws.send(JSON.stringify({ type: "transcript", role: "ai", text: llmResponse }));
              
              state = "speaking";
              ws.send(JSON.stringify({ type: "state_speaking" }));
              ws.send(JSON.stringify({ type: "tts_chunk_starts" }));

              // Split into sentences and TTS each one sequentially
              const sentences = llmResponse.match(/[^.!?…]+[.!?…]+\s?/g) || [llmResponse];
              for (const sentence of sentences) {
                const trimmed = sentence.trim();
                if (trimmed.length === 0) continue;
                await new Promise<void>((resolve) => {
                  const tts = new AzureTTSStreamer();
                  tts.on("audio_chunk", (chunk: Buffer) => ws.send(chunk));
                  tts.on("tts_complete", () => resolve());
                  tts.on("error", (err: Error) => {
                    console.error("[TTS] Sentence error:", err);
                    resolve();
                  });
                  tts.synthesize(trimmed);
                });
              }

              ws.send(JSON.stringify({ type: "tts_chunk_ends" }));
              state = "listening";
              ws.send(JSON.stringify({ type: "state_listening" }));
              
              // Skip the streaming path below
              return;
            }

            // Step 2: Streaming LLM call (only reached if tool calls were processed)
            state = "speaking";
            ws.send(JSON.stringify({ type: "state_speaking" }));
            ws.send(JSON.stringify({ type: "tts_chunk_starts" }));

            const stream = await openai.chat.completions.create({
              model: OPENAI_MODEL,
              messages: chatHistory,
              stream: true,
            });

            let sentenceBuffer = "";
            let fullResponse = "";

            const speakSentence = async (text: string) => {
              await new Promise<void>((resolve) => {
                const tts = new AzureTTSStreamer();
                tts.on("audio_chunk", (chunk: Buffer) => ws.send(chunk));
                tts.on("tts_complete", () => resolve());
                tts.on("error", (err: Error) => {
                  console.error("[TTS] Sentence error:", err);
                  resolve();
                });
                tts.synthesize(text);
              });
            };

            for await (const chunk of stream) {
              const delta = chunk.choices[0]?.delta?.content || "";
              sentenceBuffer += delta;
              fullResponse += delta;

              // Look for sentence boundaries
              const match = sentenceBuffer.match(/^(.*?[.!?…]+\s)/s);
              if (match) {
                const sentence = match[1].trim();
                sentenceBuffer = sentenceBuffer.slice(match[0].length);
                if (sentence.length > 0) {
                  console.log(`[TTS] Streaming sentence: "${sentence}"`);
                  await speakSentence(sentence);
                }
              }
            }

            // Flush remaining text
            if (sentenceBuffer.trim().length > 0) {
              await speakSentence(sentenceBuffer.trim());
            }

            llmResponse = fullResponse;
            chatHistory.push({ role: "assistant", content: llmResponse });

            console.log(`[AI RESPONSE]: "${llmResponse}"`);
            ws.send(JSON.stringify({ type: "transcript", role: "ai", text: llmResponse }));
            ws.send(JSON.stringify({ type: "tts_chunk_ends" }));
            state = "listening";
            ws.send(JSON.stringify({ type: "state_listening" }));

          } catch (err) {
            console.error("[Pipeline] ❌ OpenAI Error:", (err as Error).message);
            state = "listening";
            ws.send(JSON.stringify({ type: "state_listening" }));
          }
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
    clearInterval(keepAliveInterval);
    if (sttStreamer) sttStreamer.destroy();
  });
  ws.on("error", (err: Error) => {
    console.error("[WS] WebSocket error:", err);
    clearInterval(keepAliveInterval);
    if (sttStreamer) sttStreamer.destroy();
  });
});

// --- START THE SERVER ---
server.listen(PORT, () => {
  console.log(`🚀 Voice pipeline server listening on :${PORT}`);
});
