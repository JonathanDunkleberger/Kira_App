import { WebSocketServer } from "ws";
import type { IncomingMessage } from "http";
import { createServer } from "http";
import { URL } from "url";
import { PrismaClient } from "@prisma/client";
import { createClerkClient, verifyToken } from "@clerk/backend";
import { OpenAI } from "openai";
import { DeepgramSTTStreamer } from "./DeepgramSTTStreamer.js";
import { AzureTTSStreamer } from "./AzureTTSStreamer.js";
import { KIRA_SYSTEM_PROMPT } from "./personality.js";
import { extractAndSaveMemories } from "./memoryExtractor.js";
import { loadUserMemories } from "./memoryLoader.js";

// --- CONFIGURATION ---
const PORT = process.env.PORT ? parseInt(process.env.PORT, 10) : 10000;
const CLERK_SECRET_KEY = process.env.CLERK_SECRET_KEY!;
const OPENAI_API_KEY = process.env.OPENAI_API_KEY!;
const OPENAI_MODEL = process.env.OPENAI_MODEL || "gpt-4o-mini";

const clerkClient = createClerkClient({ secretKey: CLERK_SECRET_KEY });
const prisma = new PrismaClient();
const openai = new OpenAI({ apiKey: OPENAI_API_KEY });

const server = createServer((req, res) => {
  if (req.url === "/health") {
    res.writeHead(200, { "Content-Type": "text/plain" });
    res.end("ok");
  } else {
    res.writeHead(404);
    res.end();
  }
});
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

  let userId: string | null = null;
  let isGuest = false;

  // --- 1. AUTH & USER SETUP ---
  if (!token && !guestId) {
    console.error("[Auth] ❌ No authentication provided. Closing connection.");
    ws.close(1008, "No authentication provided");
    return;
  }

  const authPromise = (async () => {
    try {
      if (token) {
        const payload = await verifyToken(token, { secretKey: CLERK_SECRET_KEY });
        if (!payload?.sub) {
          throw new Error("Unable to resolve user id from token");
        }
        userId = payload.sub;
        isGuest = false;
        console.log(`[Auth] ✅ Authenticated user: ${userId}`);
        return true;
      } else if (guestId) {
        userId = guestId; // Client already sends "guest_<uuid>"
        isGuest = true;
        console.log(`[Auth] - Guest user: ${userId}`);
        return true;
      } else {
        throw new Error("No auth provided.");
      }
    } catch (err) {
      console.error("[Auth] ❌ Failed:", (err as Error).message);
      ws.close(1008, "Authentication failed");
      return false;
    }
  })();

  // --- RATE LIMITING (control messages only — binary audio is exempt) ---
  const MAX_CONTROL_MESSAGES_PER_SECOND = 50;
  let messageCount = 0;
  const messageCountResetInterval = setInterval(() => { messageCount = 0; }, 1000);

  // --- 2. PIPELINE SETUP ---
  let state = "listening";
  let sttStreamer: DeepgramSTTStreamer | null = null;
  let currentTurnTranscript = "";
  let currentInterimTranscript = "";
  let transcriptClearedAt = 0;
  let lastProcessedTranscript = "";
  let latestImages: string[] | null = null;
  let lastImageTimestamp = 0;
  let viewingContext = ""; // Track the current media context
  let lastEouTime = 0;
  const EOU_DEBOUNCE_MS = 600; // Ignore EOU if within 600ms of last one
  let consecutiveEmptyEOUs = 0;
  let lastTranscriptReceivedAt = Date.now();
  let isReconnectingDeepgram = false;
  let clientDisconnected = false;

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
    { role: "system", content: KIRA_SYSTEM_PROMPT },
  ];

  // --- L1: In-Conversation Memory ---
  let conversationSummary = "";

  // --- CONTEXT MANAGEMENT CONSTANTS ---
  const MAX_RECENT_MESSAGES = 10;
  const SUMMARIZE_THRESHOLD = 14;
  const MESSAGES_TO_SUMMARIZE = 4;

  // --- USAGE TRACKING ---
  const FREE_LIMIT_SECONDS = parseInt(process.env.FREE_TRIAL_SECONDS || "900"); // 15 min/day
  const PRO_LIMIT_SECONDS = parseInt(process.env.PRO_MONTHLY_SECONDS || "36000"); // 10 hrs/month
  let sessionStartTime: number | null = null;
  let usageCheckInterval: NodeJS.Timeout | null = null;
  let isProUser = false;
  let guestUsageSeconds = 0;

  // --- Reusable Deepgram initialization ---
  async function initDeepgram() {
    const streamer = new DeepgramSTTStreamer();
    await streamer.start();

    streamer.on(
      "transcript",
      (transcript: string, isFinal: boolean) => {
        // Reset health tracking — Deepgram is alive
        consecutiveEmptyEOUs = 0;
        lastTranscriptReceivedAt = Date.now();

        // Ignore stale transcripts that arrive within 500ms of clearing
        // These are from Deepgram's pipeline processing old audio from the previous turn
        if (Date.now() - transcriptClearedAt < 1500) {
          console.log(`[STT] Ignoring stale transcript (${Date.now() - transcriptClearedAt}ms after clear): "${transcript}"`);
          return;
        }

        if (isFinal) {
          currentTurnTranscript += transcript + " ";
          currentInterimTranscript = ""; // Clear interim since we got a final
        } else {
          currentInterimTranscript = transcript; // Always track latest interim
        }
        // Send transcript to client for real-time display
        ws.send(JSON.stringify({ 
          type: "transcript", 
          role: "user", 
          text: currentTurnTranscript.trim() || transcript 
        }));
      }
    );

    streamer.on("error", (err: Error) => {
      console.error("[Pipeline] ❌ STT Error:", err.message);
      reconnectDeepgram();
    });

    streamer.on("close", () => {
      console.log("[Deepgram] Connection closed unexpectedly. Triggering reconnect.");
      reconnectDeepgram();
    });

    return streamer;
  }

  // --- Self-healing Deepgram reconnection ---
  async function reconnectDeepgram() {
    if (isReconnectingDeepgram || clientDisconnected) return;
    isReconnectingDeepgram = true;
    console.log("[Deepgram] ⚠️ Connection appears dead. Reconnecting...");

    try {
      // Close old connection if still open
      if (sttStreamer) {
        try { sttStreamer.destroy(); } catch (e) { /* ignore */ }
      }

      // Re-create with same config and listeners
      sttStreamer = await initDeepgram();

      // Reset tracking
      consecutiveEmptyEOUs = 0;
      lastTranscriptReceivedAt = Date.now();
      console.log("[Deepgram] ✅ Reconnected successfully.");
    } catch (err) {
      console.error("[Deepgram] ❌ Reconnection failed:", (err as Error).message);
    } finally {
      isReconnectingDeepgram = false;
    }
  }

  ws.on("message", async (message: Buffer, isBinary: boolean) => {
    // Wait for auth to complete before processing ANY message
    const isAuthenticated = await authPromise;
    if (!isAuthenticated) return;

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
        // Rate limiting: only count control (JSON) messages, never binary audio
        messageCount++;
        if (messageCount > MAX_CONTROL_MESSAGES_PER_SECOND) {
          console.warn("[WS] Rate limit exceeded, dropping control message");
          return;
        }

        console.log(`[WS] Control message: ${controlMessage.type}`);
        if (controlMessage.type === "start_stream") {
          console.log("[WS] Received start_stream. Initializing pipeline...");

          // --- L2: Load persistent memories for signed-in users ---
          if (!isGuest && userId) {
            try {
              const memoryBlock = await loadUserMemories(prisma, userId);
              if (memoryBlock) {
                chatHistory.push({ role: "system", content: memoryBlock });
                console.log(
                  `[Memory] Loaded ${memoryBlock.length} chars of persistent memory`
                );
              }
            } catch (err) {
              console.error(
                "[Memory] Failed to load memories:",
                (err as Error).message
              );
            }
          }

          // --- USAGE: Check limits on connect ---
          if (!isGuest && userId) {
            try {
              const dbUser = await prisma.user.findUnique({
                where: { clerkId: userId },
                select: {
                  dailyUsageSeconds: true,
                  lastUsageDate: true,
                  stripeSubscriptionId: true,
                  stripeCurrentPeriodEnd: true,
                },
              });

              if (dbUser) {
                isProUser = !!(
                  dbUser.stripeSubscriptionId &&
                  dbUser.stripeCurrentPeriodEnd &&
                  dbUser.stripeCurrentPeriodEnd.getTime() > Date.now()
                );

                // Reset counter based on tier:
                // - Free: resets daily (15 min/day)
                // - Pro:  resets each billing period (10 hrs/month)
                let currentUsage = dbUser.dailyUsageSeconds;
                let shouldReset = false;

                if (isProUser && dbUser.stripeCurrentPeriodEnd) {
                  // Pro resets when a new billing period starts.
                  // Billing period start ≈ periodEnd minus ~30 days.
                  // If lastUsageDate is before the current period started,
                  // the counter belongs to a previous cycle.
                  const periodEnd = dbUser.stripeCurrentPeriodEnd.getTime();
                  const approxPeriodStart = periodEnd - 30 * 24 * 60 * 60 * 1000;
                  const lastUsageMs = dbUser.lastUsageDate?.getTime() || 0;
                  shouldReset = lastUsageMs < approxPeriodStart;
                } else {
                  // Free users reset daily
                  const today = new Date().toDateString();
                  const lastUsage = dbUser.lastUsageDate?.toDateString();
                  shouldReset = today !== lastUsage;
                }

                if (shouldReset) {
                  currentUsage = 0;
                  await prisma.user.update({
                    where: { clerkId: userId },
                    data: { dailyUsageSeconds: 0, lastUsageDate: new Date() },
                  });
                }

                const limit = isProUser
                  ? PRO_LIMIT_SECONDS
                  : FREE_LIMIT_SECONDS;
                if (currentUsage >= limit) {
                  ws.send(
                    JSON.stringify({ type: "error", code: "limit_reached" })
                  );
                  ws.close(1008, "Usage limit reached");
                  return;
                }

                ws.send(
                  JSON.stringify({
                    type: "session_config",
                    isPro: isProUser,
                    remainingSeconds: limit - currentUsage,
                  })
                );
              }
            } catch (err) {
              console.error(
                "[Usage] Failed to check limits:",
                (err as Error).message
              );
            }
          }

          // --- USAGE: Start session timer ---
          sessionStartTime = Date.now();
          usageCheckInterval = setInterval(async () => {
            if (!sessionStartTime) return;

            const elapsed = Math.floor(
              (Date.now() - sessionStartTime) / 1000
            );

            if (isGuest) {
              guestUsageSeconds = elapsed;
              if (guestUsageSeconds >= FREE_LIMIT_SECONDS) {
                ws.send(
                  JSON.stringify({ type: "error", code: "limit_reached" })
                );
                ws.close(1008, "Guest usage limit reached");
                return;
              }
            } else if (userId) {
              try {
                await prisma.user.update({
                  where: { clerkId: userId },
                  data: {
                    dailyUsageSeconds: { increment: 30 },
                    lastUsageDate: new Date(),
                  },
                });

                const dbUser = await prisma.user.findUnique({
                  where: { clerkId: userId },
                  select: { dailyUsageSeconds: true },
                });

                const limit = isProUser
                  ? PRO_LIMIT_SECONDS
                  : FREE_LIMIT_SECONDS;
                if (dbUser && dbUser.dailyUsageSeconds >= limit) {
                  ws.send(
                    JSON.stringify({ type: "error", code: "limit_reached" })
                  );
                  ws.close(1008, "Usage limit reached");
                }
              } catch (err) {
                console.error(
                  "[Usage] DB update failed:",
                  (err as Error).message
                );
              }
            }
          }, 30000);

          sttStreamer = await initDeepgram();
          ws.send(JSON.stringify({ type: "stream_ready" }));
        } else if (controlMessage.type === "eou") {
          // Debounce: ignore EOU if one was just processed
          const now = Date.now();
          if (now - lastEouTime < EOU_DEBOUNCE_MS) {
            console.log(`[EOU] Ignoring spurious EOU (debounced, ${now - lastEouTime}ms since last)`);
            return;
          }

          if (state !== "listening" || !sttStreamer) {
            return; // Already thinking/speaking
          }

          // CRITICAL: Lock state IMMEDIATELY to prevent audio from leaking into next turn
          state = "thinking";

          // If no final transcript, immediately use interim (no waiting needed)
          if (currentTurnTranscript.trim().length === 0 && currentInterimTranscript.trim().length > 0) {
            console.log(`[EOU] Using interim transcript: "${currentInterimTranscript}"`);
            currentTurnTranscript = currentInterimTranscript;
          }

          // Final check: if still empty, nothing was actually said
          if (currentTurnTranscript.trim().length === 0) {
            consecutiveEmptyEOUs++;
            console.log(`[EOU] No transcript available (${consecutiveEmptyEOUs} consecutive empty EOUs), ignoring EOU.`);
            state = "listening"; // Reset state — don't get stuck in "thinking"

            if (consecutiveEmptyEOUs >= 2) {
              console.log("[EOU] Multiple empty EOUs detected — Deepgram likely dead. Triggering reconnect.");
              await reconnectDeepgram();
            }
            return;
          }

          lastEouTime = now; // Record this EOU time for debouncing
          const userMessage = currentTurnTranscript.trim();
          currentTurnTranscript = ""; // Reset for next turn
          currentInterimTranscript = ""; // Reset interim too
          transcriptClearedAt = Date.now();

          // Content-based dedup: reject if identical to last processed message
          if (userMessage === lastProcessedTranscript) {
            console.log(`[EOU] Ignoring duplicate transcript: "${userMessage}"`);
            state = "listening";
            return;
          }
          lastProcessedTranscript = userMessage;

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

          // --- CONTEXT MANAGEMENT (Sliding Window + Rolling Summary / L1) ---
          // Count non-system messages
          const nonSystemCount = chatHistory.filter(m => m.role !== "system").length;

          if (nonSystemCount > SUMMARIZE_THRESHOLD) {
            // Find first non-system message index
            let firstMsgIdx = chatHistory.findIndex(m => m.role !== "system");

            // Skip summary message if it exists
            if (
              typeof chatHistory[firstMsgIdx]?.content === "string" &&
              (chatHistory[firstMsgIdx].content as string).startsWith("[CONVERSATION SO FAR]")
            ) {
              firstMsgIdx++;
            }

            // Gather messages to compress
            const toCompress = chatHistory.slice(firstMsgIdx, firstMsgIdx + MESSAGES_TO_SUMMARIZE);
            const messagesText = toCompress
              .map(m => `${m.role}: ${typeof m.content === "string" ? m.content : "[media]"}`)
              .join("\n");

            // Update rolling summary via cheap LLM call
            try {
              const summaryResp = await openai.chat.completions.create({
                model: "gpt-4o-mini",
                messages: [
                  {
                    role: "system",
                    content:
                      "Summarize this conversation segment in under 150 words. Preserve: names, key facts, emotional context, topics, plans. Third person present tense. Be concise.",
                  },
                  {
                    role: "user",
                    content: `Existing summary:\n${conversationSummary || "(start of conversation)"}\n\nNew messages:\n${messagesText}\n\nUpdated summary:`,
                  },
                ],
                max_tokens: 200,
                temperature: 0.3,
              });

              conversationSummary =
                summaryResp.choices[0]?.message?.content || conversationSummary;
              console.log(
                `[Memory:L1] Updated summary (${conversationSummary.length} chars)`
              );
            } catch (err) {
              console.error(
                "[Memory:L1] Summary failed:",
                (err as Error).message
              );
            }

            // Remove compressed messages
            chatHistory.splice(firstMsgIdx, MESSAGES_TO_SUMMARIZE);

            // Insert/update summary message (right after system messages, before conversation)
            const summaryContent = `[CONVERSATION SO FAR]: ${conversationSummary}`;
            const existingSummaryIdx = chatHistory.findIndex(
              m =>
                typeof m.content === "string" &&
                (m.content as string).startsWith("[CONVERSATION SO FAR]")
            );

            if (existingSummaryIdx >= 0) {
              chatHistory[existingSummaryIdx] = {
                role: "system",
                content: summaryContent,
              };
            } else {
              // Insert after all system messages but before first user/assistant message
              const insertAt = chatHistory.filter(
                m => m.role === "system"
              ).length;
              chatHistory.splice(insertAt, 0, {
                role: "system",
                content: summaryContent,
              });
            }

            console.log(
              `[Context] Compressed history. ${chatHistory.length} messages in context.`
            );
          }

          let llmResponse = "";
          try {
            // Step 1: Check for tool calls with a non-streaming request
            const initialCompletion = await openai.chat.completions.create({
              model: OPENAI_MODEL,
              messages: chatHistory,
              tools: tools,
              tool_choice: "auto",
              temperature: 0.85,
              max_tokens: 300,
              frequency_penalty: 0.3,
              presence_penalty: 0.2,
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

              // Yield one event-loop tick so the WebSocket control frames
              // (state_speaking, tts_chunk_starts) are flushed to the client
              // BEFORE any binary TTS audio frames are sent
              await new Promise(resolve => setImmediate(resolve));

              try {
                // Split on sentence-ending punctuation followed by space+uppercase or end of string
                // Avoids splitting on "Dr.", "e.g.", "3.14", "U.S.A.", etc.
                const sentences = llmResponse.match(/[^.!?…]*(?:[.!?…](?:\s+(?=[A-Z"])|$))+/g) || [llmResponse];
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
              } catch (ttsErr) {
                console.error("[TTS] Fatal error in TTS pipeline:", ttsErr);
              } finally {
                ws.send(JSON.stringify({ type: "tts_chunk_ends" }));
                currentTurnTranscript = "";
                currentInterimTranscript = "";
                transcriptClearedAt = Date.now();
                state = "listening";
                ws.send(JSON.stringify({ type: "state_listening" }));
                console.log("[STATE] Back to listening, transcripts cleared.");
              }
              
              // Skip the streaming path below
              return;
            }

            // Step 2: Streaming LLM call (only reached if tool calls were processed)
            // NOTE: This is an intentional second LLM call. After processing tool calls (e.g.
            // update_viewing_context), we need a fresh completion that incorporates the tool
            // results. Tools are omitted here to prevent infinite chaining. Adds ~1-2s latency
            // on tool-call turns only (which are infrequent).
            state = "speaking";
            ws.send(JSON.stringify({ type: "state_speaking" }));
            ws.send(JSON.stringify({ type: "tts_chunk_starts" }));

            // Yield one event-loop tick so the WebSocket control frames
            // (state_speaking, tts_chunk_starts) are flushed to the client
            // BEFORE any binary TTS audio frames are sent
            await new Promise(resolve => setImmediate(resolve));

            try {
              const stream = await openai.chat.completions.create({
                model: OPENAI_MODEL,
                messages: chatHistory,
                stream: true,
                temperature: 0.85,
                max_tokens: 300,
                frequency_penalty: 0.3,
                presence_penalty: 0.2,
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

                // Split on sentence-ending punctuation followed by space+uppercase or end
                const match = sentenceBuffer.match(/^(.*?[.!?…]+\s+(?=[A-Z"]))/s);
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
            } catch (ttsErr) {
              console.error("[TTS] Fatal error in streaming TTS pipeline:", ttsErr);
            } finally {
              ws.send(JSON.stringify({ type: "tts_chunk_ends" }));
              currentTurnTranscript = "";
              currentInterimTranscript = "";
              transcriptClearedAt = Date.now();
              state = "listening";
              ws.send(JSON.stringify({ type: "state_listening" }));
              console.log("[STATE] Back to listening, transcripts cleared.");
            }

          } catch (err) {
            console.error("[Pipeline] ❌ OpenAI Error:", (err as Error).message);
            // Ensure client always returns to listening state on any error
            try {
              ws.send(JSON.stringify({ type: "tts_chunk_ends" }));
            } catch (_) { /* ws may be closed */ }
            currentTurnTranscript = "";
            currentInterimTranscript = "";
            transcriptClearedAt = Date.now();
            state = "listening";
            try {
              ws.send(JSON.stringify({ type: "state_listening" }));
            } catch (_) { /* ws may be closed */ }
            console.log("[STATE] Back to listening after error, transcripts cleared.");
          }
        } else if (controlMessage.type === "interrupt") {
          // Interrupt disabled — too sensitive (desk taps, coughs break conversation)
          // Kira finishes her response, then listens
          console.log("[WS] Interrupt received but ignored (feature disabled)");
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
        } else if (controlMessage.type === "text_message") {
          // --- TEXT CHAT: Skip STT and TTS, go directly to LLM ---
          if (state !== "listening") return;

          const userMessage = controlMessage.text?.trim();
          if (!userMessage || userMessage.length === 0) return;
          if (userMessage.length > 2000) return; // Prevent abuse

          state = "thinking";
          ws.send(JSON.stringify({ type: "state_thinking" }));

          chatHistory.push({ role: "user", content: userMessage });

          // --- CONTEXT MANAGEMENT (reuse same rolling summary logic) ---
          const txtNonSystemCount = chatHistory.filter(m => m.role !== "system").length;
          if (txtNonSystemCount > SUMMARIZE_THRESHOLD) {
            let txtFirstMsgIdx = chatHistory.findIndex(m => m.role !== "system");
            if (
              typeof chatHistory[txtFirstMsgIdx]?.content === "string" &&
              (chatHistory[txtFirstMsgIdx].content as string).startsWith("[CONVERSATION SO FAR]")
            ) {
              txtFirstMsgIdx++;
            }
            const txtToCompress = chatHistory.slice(txtFirstMsgIdx, txtFirstMsgIdx + MESSAGES_TO_SUMMARIZE);
            const txtMessagesText = txtToCompress
              .map(m => `${m.role}: ${typeof m.content === "string" ? m.content : "[media]"}`)
              .join("\n");
            try {
              const txtSummaryResp = await openai.chat.completions.create({
                model: "gpt-4o-mini",
                messages: [
                  { role: "system", content: "Summarize this conversation segment in under 150 words. Preserve: names, key facts, emotional context, topics, plans. Third person present tense. Be concise." },
                  { role: "user", content: `Existing summary:\n${conversationSummary || "(start of conversation)"}\n\nNew messages:\n${txtMessagesText}\n\nUpdated summary:` },
                ],
                max_tokens: 200,
                temperature: 0.3,
              });
              conversationSummary = txtSummaryResp.choices[0]?.message?.content || conversationSummary;
            } catch (err) {
              console.error("[Memory:L1] Text chat summary failed:", (err as Error).message);
            }
            chatHistory.splice(txtFirstMsgIdx, MESSAGES_TO_SUMMARIZE);
            const txtSummaryContent = `[CONVERSATION SO FAR]: ${conversationSummary}`;
            const txtExistingSummaryIdx = chatHistory.findIndex(
              m => typeof m.content === "string" && (m.content as string).startsWith("[CONVERSATION SO FAR]")
            );
            if (txtExistingSummaryIdx >= 0) {
              chatHistory[txtExistingSummaryIdx] = { role: "system", content: txtSummaryContent };
            } else {
              const txtInsertAt = chatHistory.filter(m => m.role === "system").length;
              chatHistory.splice(txtInsertAt, 0, { role: "system", content: txtSummaryContent });
            }
          }

          try {
            const txtCompletion = await openai.chat.completions.create({
              model: OPENAI_MODEL,
              messages: chatHistory,
              tools: tools,
              tool_choice: "auto",
              temperature: 0.85,
              max_tokens: 300,
              frequency_penalty: 0.3,
              presence_penalty: 0.2,
            });

            const txtInitialMessage = txtCompletion.choices[0]?.message;
            let txtLlmResponse = "";

            if (txtInitialMessage?.tool_calls) {
              chatHistory.push(txtInitialMessage);
              for (const toolCall of txtInitialMessage.tool_calls) {
                if (toolCall.function.name === "update_viewing_context") {
                  const args = JSON.parse(toolCall.function.arguments);
                  viewingContext = args.context;
                  const systemMsg = chatHistory[0] as OpenAI.Chat.ChatCompletionSystemMessageParam;
                  if (systemMsg) {
                    let content = systemMsg.content as string;
                    const contextMarker = "\n\n[CURRENT CONTEXT]:";
                    if (content.includes(contextMarker)) {
                      content = content.split(contextMarker)[0];
                    }
                    systemMsg.content = content + `${contextMarker} ${viewingContext}`;
                  }
                  chatHistory.push({ role: "tool", tool_call_id: toolCall.id, content: `Context updated to: ${viewingContext}` });
                }
              }
              const txtFollowUp = await openai.chat.completions.create({
                model: OPENAI_MODEL,
                messages: chatHistory,
                temperature: 0.85,
                max_tokens: 300,
              });
              txtLlmResponse = txtFollowUp.choices[0]?.message?.content || "";
            } else {
              txtLlmResponse = txtInitialMessage?.content || "";
            }

            chatHistory.push({ role: "assistant", content: txtLlmResponse });

            ws.send(JSON.stringify({
              type: "text_response",
              text: txtLlmResponse,
            }));
          } catch (err) {
            console.error("[TextChat] Error:", (err as Error).message);
            ws.send(JSON.stringify({ type: "error", message: "Failed to get response" }));
          } finally {
            state = "listening";
            ws.send(JSON.stringify({ type: "state_listening" }));
          }
        }
      } else if (message instanceof Buffer) {
        if (state === "listening" && sttStreamer) {
          sttStreamer.write(message); // Only forward audio when listening
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

  ws.on("close", async (code: number) => {
    console.log(`[WS] Client disconnected. Code: ${code}`);
    clientDisconnected = true;
    clearInterval(keepAliveInterval);
    clearInterval(messageCountResetInterval);
    if (usageCheckInterval) clearInterval(usageCheckInterval);
    if (sttStreamer) sttStreamer.destroy();

    // --- MEMORY EXTRACTION (signed-in users only) ---
    if (!isGuest && userId) {
      try {
        const userMsgs = chatHistory
          .filter(m => m.role === "user" || m.role === "assistant")
          .map(m => ({
            role: m.role as string,
            content: typeof m.content === "string"
              ? m.content
              : "[media message]",
          }));

        if (userMsgs.length >= 2) {
          // 1. Save conversation to DB
          const conversation = await prisma.conversation.create({
            data: {
              userId: userId,
              messages: {
                create: userMsgs.map(m => ({
                  role: m.role,
                  content: m.content,
                })),
              },
            },
          });
          console.log(
            `[Memory] Saved conversation ${conversation.id} (${userMsgs.length} messages)`
          );

          // 2. Extract memories
          await extractAndSaveMemories(
            openai,
            prisma,
            userId,
            userMsgs,
            conversationSummary
          );
        }
      } catch (err) {
        console.error(
          "[Memory] Post-disconnect save failed:",
          (err as Error).message
        );
      }
    }
  });

  ws.on("error", (err: Error) => {
    console.error("[WS] WebSocket error:", err);
    clientDisconnected = true;
    clearInterval(keepAliveInterval);
    clearInterval(messageCountResetInterval);
    if (usageCheckInterval) clearInterval(usageCheckInterval);
    if (sttStreamer) sttStreamer.destroy();
  });
});

// --- START THE SERVER ---
server.listen(PORT, () => {
  console.log(`🚀 Voice pipeline server listening on :${PORT}`);
});
