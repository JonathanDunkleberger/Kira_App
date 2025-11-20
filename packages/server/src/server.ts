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
const STRIPE_SECRET_KEY = process.env.STRIPE_SECRET_KEY!;

const clerkClient = createClerkClient({ secretKey: CLERK_SECRET_KEY });
const prisma = new PrismaClient();
const openai = new OpenAI({ apiKey: OPENAI_API_KEY });

const server = createServer();
const wss = new WebSocketServer({ server });

console.log("[Server] Starting...");
console.log("[Config] PORT:", PORT);
console.log("[Config] CLERK_SECRET_KEY:", CLERK_SECRET_KEY ? "Set" : "Missing");
console.log("[Config] OPENAI_API_KEY:", OPENAI_API_KEY ? "Set" : "Missing");
console.log("[Config] STRIPE_SECRET_KEY:", STRIPE_SECRET_KEY ? "Set" : "Missing");
console.log("[Config] DEEPGRAM_API_KEY:", process.env.DEEPGRAM_API_KEY ? "Set" : "Missing");
console.log("[Config] AZURE_SPEECH_KEY:", process.env.AZURE_SPEECH_KEY ? "Set" : "Missing");

// --- HELPER: Check Stripe Subscription Directly ---
const checkStripeSubscription = async (customerId: string): Promise<boolean> => {
  if (!STRIPE_SECRET_KEY) {
      console.error("[Stripe] Missing STRIPE_SECRET_KEY");
      return false;
  }
  try {
    // Fetch all subscriptions for the customer (limit 10 is enough)
    // We don't filter by status in the query to ensure we see everything
    const response = await fetch(
      `https://api.stripe.com/v1/subscriptions?customer=${customerId}&limit=10`,
      {
        headers: {
          Authorization: `Bearer ${STRIPE_SECRET_KEY}`,
        },
      }
    );
    
    if (!response.ok) {
        const err = await response.text();
        console.error(`[Stripe] API Error: ${response.status} - ${err}`);
        return false;
    }

    const data = await response.json();
    
    // Check for any active or trialing subscription
    const activeSub = data.data && data.data.find((sub: any) => 
      sub.status === 'active' || sub.status === 'trialing'
    );

    if (activeSub) {
        console.log(`[Stripe] Found active subscription: ${activeSub.id} (Status: ${activeSub.status})`);
        return true;
    }
    
    console.log(`[Stripe] No active subscriptions found for customer ${customerId}`);
    return false;
  } catch (e) {
    console.error("[Stripe] Failed to check subscription:", e);
    return false;
  }
};

wss.on("connection", async (ws: any, req: IncomingMessage) => {
  console.log("[WS] New client connecting...");
  const url = new URL(req.url!, `wss://${req.headers.host}`);
  const token = url.searchParams.get("token");
  const guestId = url.searchParams.get("guestId");

  let userId: string | null = null;
  let isAuthenticated = false;
  let userDbId: string | null = null; // The internal DB ID (cuid)
  let userName: string | null = null;
  let userMemory: string | null = null;
  let isPro = false;
  let dailyUsageSeconds = 0;
  const FREE_LIMIT_SECONDS = 15 * 60; // 15 minutes
  const PRO_LIMIT_SECONDS = 4 * 60 * 60; // 4 hours
  let limit = FREE_LIMIT_SECONDS;

  // Usage Tracking Timer
  let usageInterval: NodeJS.Timeout | null = null;
  const messageQueue: { message: Buffer | string, isBinary: boolean }[] = [];

  // --- 2. PIPELINE SETUP ---
  let state = "listening";
  let sttStreamer: DeepgramSTTStreamer | null = null;
  let ttsStreamer: AzureTTSStreamer | null = null;
  let currentTurnTranscript = "";
  let latestInterimTranscript = "";
  const chatHistory: OpenAI.Chat.ChatCompletionMessageParam[] = [
    {
      role: "system",
      content:
        "You are Kira, a helpful AI companion. You are a 'ramble bot', so you listen patiently. Your responses are friendly, engaging, and conversational. Feel free to elaborate on your thoughts, but keep it natural. You never interrupt.",
    },
  ];

  // --- HELPER FUNCTIONS ---

  const startSTT = async () => {
    if (sttStreamer) {
      console.log("[STT] Restarting STT stream...");
      sttStreamer.destroy();
      sttStreamer = null;
    } else {
      console.log("[STT] Starting STT stream...");
    }

    try {
      sttStreamer = new DeepgramSTTStreamer();
      await sttStreamer.start();

      sttStreamer.on("transcript", (transcript: string, isFinal: boolean) => {
        if (isFinal) {
          currentTurnTranscript += transcript + " ";
          latestInterimTranscript = "";
        } else {
          latestInterimTranscript = transcript;
        }
        ws.send(
          JSON.stringify({
            type: "transcript",
            role: "user",
            text: isFinal
              ? currentTurnTranscript
              : currentTurnTranscript + transcript,
            isFinal,
          })
        );
      });

      sttStreamer.on("error", (err: Error) => {
        console.error("[Pipeline] ❌ STT Error:", err.message);
      });
    } catch (err) {
      console.error("[Pipeline] ❌ Failed to start STT:", err);
    }
  };

  const processMessage = async (message: Buffer | string, isBinary: boolean) => {
    try {
      let controlMessage: any = null;
      
      // Try to parse as JSON first if it's not explicitly binary audio
      if (!isBinary || (Buffer.isBuffer(message) && message.length < 1000)) { 
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

        if (controlMessage.type === "interrupt") {
          console.log("[WS] 🛑 Interruption signal received.");
          if (ttsStreamer) {
            console.log("[WS] Stopping active TTS streamer...");
            ttsStreamer.stop();
            ttsStreamer = null;
          }
          // If we were speaking or thinking, reset to listening
          if (state === "speaking" || state === "thinking") {
             state = "listening";
             ws.send(JSON.stringify({ type: "state_listening" }));
             await startSTT();
          }
        } else if (controlMessage.type === "start_stream") {
          console.log("[WS] Received start_stream. Initializing pipeline...");
          await startSTT();
          ws.send(JSON.stringify({ type: "stream_ready" }));
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
          ttsStreamer = new AzureTTSStreamer();
          ws.send(JSON.stringify({ type: "tts_chunk_starts" }));

          ttsStreamer.on("audio_chunk", (chunk: Buffer) => ws.send(chunk));
          ttsStreamer.on("tts_complete", async () => {
            ws.send(JSON.stringify({ type: "tts_chunk_ends" }));
            state = "listening";
            ws.send(JSON.stringify({ type: "state_listening" }));
            ttsStreamer = null;

            if (dailyUsageSeconds >= limit) {
                 console.log("[Usage] Limit reached after response. Closing.");
                 ws.send(JSON.stringify({ type: "error", code: "limit_reached", message: "Daily limit reached." }));
                 ws.close(1008, "Daily limit reached");
                 return;
            }

            await startSTT();
          });
          ttsStreamer.on("error", async (err: Error) => {
            console.error("[Pipeline] ❌ TTS Error:", err);
            state = "listening";
            ws.send(JSON.stringify({ type: "state_listening" }));
            ttsStreamer = null;
            await startSTT();
          });

          ttsStreamer.synthesize(llmResponse);
        }
      } 
      
      // Handle Binary Audio Data
      if (Buffer.isBuffer(message) && !controlMessage) {
        if (state === "listening" && sttStreamer) {
          // Log occasional audio packet to prove we are receiving data
          if (Math.random() < 0.01) {
             // console.log(`[WS] 🎤 Received audio chunk (${message.byteLength} bytes)`);
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

  const saveMemory = async () => {
      if (!userDbId || chatHistory.length < 4) return;
      
      console.log("[Memory] Generating summary...");
      try {
          // Create a summary of the current conversation
          const summaryPrompt: OpenAI.Chat.ChatCompletionMessageParam[] = [
              { role: "system", content: "Summarize the key facts, preferences, and topics discussed in this conversation. Be concise. Focus on what you learned about the user." },
              ...chatHistory.filter(m => m.role !== "system")
          ];
          
          const completion = await openai.chat.completions.create({
              model: "gpt-4o-mini",
              messages: summaryPrompt
          });
          
          const newMemory = completion.choices[0]?.message?.content;
          if (newMemory) {
              console.log(`[Memory] New summary: ${newMemory}`);
              // Append to existing memory
              const updatedMemory = userMemory ? `${userMemory}\n\n[${new Date().toLocaleDateString()}] ${newMemory}` : `[${new Date().toLocaleDateString()}] ${newMemory}`;
              
              await prisma.user.update({
                  where: { id: userDbId },
                  data: { memory: updatedMemory }
              });
              console.log("[Memory] Saved to DB.");
          }
      } catch (e) {
          console.error("[Memory] Failed to save memory:", e);
      }
  };

  const initializeSession = async () => {
    try {
      // 1. Resolve User ID
      if (token) {
        const payload = await verifyToken(token, { secretKey: CLERK_SECRET_KEY });
        if (!payload?.sub) {
          throw new Error("Unable to resolve user id from token");
        }
        userId = payload.sub;
        console.log(`[Auth] ✅ Authenticated user: ${userId}`);
      } else if (guestId) {
        userId = `guest_${guestId}`;
        console.log(`[Auth] 👤 Guest user: ${userId}`);
      } else {
        throw new Error("No auth provided.");
      }

      // 2. DB Sync & Fetch (Unified for both Auth and Guest)
      let user = await prisma.user.findUnique({ where: { clerkId: userId } });
      
      if (!user) {
          let email = `guest-${userId}@example.com`;
          let name = "Guest";

          // Only fetch Clerk details if it's a real user
          if (!userId.startsWith("guest_")) {
              try {
                  const clerkUser = await clerkClient.users.getUser(userId);
                  email = clerkUser.emailAddresses[0]?.emailAddress || email;
                  name = `${clerkUser.firstName || ""} ${clerkUser.lastName || ""}`.trim() || name;
              } catch (e) {
                  console.warn("[Auth] Failed to fetch Clerk user details:", e);
              }
          }
          
          // Create user (works for both Guest and Auth)
          user = await prisma.user.create({
              data: {
                  clerkId: userId,
                  email: email,
                  name: name,
              }
          });
      }

      userDbId = user.id;
      userName = user.name;
      userMemory = user.memory;
      dailyUsageSeconds = user.dailyUsageSeconds;
      
      // 3. Check if usage needs reset (new day)
      const lastUsage = new Date(user.lastUsageDate);
      const now = new Date();
      if (lastUsage.getDate() !== now.getDate() || lastUsage.getMonth() !== now.getMonth() || lastUsage.getFullYear() !== now.getFullYear()) {
          console.log("[Usage] New day detected. Resetting usage.");
          dailyUsageSeconds = 0;
          await prisma.user.update({
              where: { id: user.id },
              data: { dailyUsageSeconds: 0, lastUsageDate: now }
          });
      }

      // 4. Check Pro Status
      if (user.stripeSubscriptionId && user.stripeCurrentPeriodEnd && user.stripeCurrentPeriodEnd > new Date()) {
          isPro = true;
      } else if (user.stripeCustomerId) {
          // Fallback: Check Stripe directly if DB says not pro but we have a customer ID
          // This handles cases where webhook failed or is delayed (common in dev)
          console.log(`[Auth] Checking Stripe API for customer ${user.stripeCustomerId}...`);
          const hasActiveSubscription = await checkStripeSubscription(user.stripeCustomerId);
          if (hasActiveSubscription) {
              console.log("[Auth] Stripe API confirmed active subscription. Updating DB...");
              isPro = true;
              // Self-heal the DB
              // Note: We don't have the sub ID here easily without more parsing, but we can at least set a future date
              // to avoid hitting API every time.
              await prisma.user.update({
                  where: { id: user.id },
                  data: { 
                      stripeCurrentPeriodEnd: new Date(Date.now() + 24 * 60 * 60 * 1000) // Set to 24h from now as a temporary fix
                  }
              });
          } else {
              console.log("[Auth] Stripe API check returned false.");
          }
      } else {
          console.log(`[Auth] User ${userId} has no Stripe Customer ID. Cannot check fallback.`);
      }

      // 5. Check Limits
      limit = isPro ? PRO_LIMIT_SECONDS : FREE_LIMIT_SECONDS;
      console.log(`[Usage] User: ${userId} | Pro: ${isPro} | Usage: ${dailyUsageSeconds}/${limit}`);

      if (dailyUsageSeconds >= limit) {
          console.log(`[Usage] Limit reached: ${dailyUsageSeconds}/${limit}`);
          ws.send(JSON.stringify({ type: "error", code: "limit_reached", message: "Daily limit reached." }));
          ws.close(1008, "Daily limit reached");
          return;
      }

      // 6. Start Usage Tracking
      usageInterval = setInterval(async () => {
          dailyUsageSeconds += 10;
          try {
             await prisma.user.update({
                 where: { id: user!.id },
                 data: { dailyUsageSeconds: dailyUsageSeconds, lastUsageDate: new Date() }
             });
             
             if (dailyUsageSeconds >= limit) {
                 if (state === "speaking" || state === "thinking") {
                     console.log("[Usage] Limit reached, waiting for response to complete...");
                     return;
                 }
                 console.log("[Usage] Limit reached. Closing connection.");
                 ws.send(JSON.stringify({ type: "error", code: "limit_reached", message: "Daily limit reached." }));
                 ws.close(1008, "Daily limit reached");
             }
          } catch (e) {
              console.error("[Usage] Failed to update usage:", e);
          }
      }, 10000);
      
      // --- MEMORY INJECTION ---
      if (userName) {
          chatHistory[0].content += ` The user's name is ${userName}.`;
      }
      if (userMemory) {
          chatHistory[0].content += `\n\nHere is a summary of past conversations:\n${userMemory}`;
      }

      isAuthenticated = true;
      console.log(`[Auth] Session initialized. Processing ${messageQueue.length} queued messages...`);
      
      for (const item of messageQueue) {
          await processMessage(item.message, item.isBinary);
      }
      messageQueue.length = 0;

    } catch (err) {
      console.error("[Auth] ❌ Failed:", (err as Error).message);
      ws.close(1008, "Authentication failed");
    }
  };

  // --- EVENT LISTENERS ---
  ws.on("message", (message: Buffer | string, isBinary: boolean) => {
      if (!isAuthenticated) {
          console.log("[WS] Queuing message until auth completes...");
          messageQueue.push({ message, isBinary });
      } else {
          processMessage(message, isBinary);
      }
  });

  ws.on("close", async (code: number) => {
    console.log(`[WS] Client disconnected. Code: ${code}`);
    if (usageInterval) clearInterval(usageInterval);
    if (sttStreamer) sttStreamer.destroy();
    
    // Save memory
    await saveMemory();
  });

  ws.on("error", (err: Error) => {
    console.error("[WS] WebSocket error:", err);
    if (usageInterval) clearInterval(usageInterval);
    if (sttStreamer) sttStreamer.destroy();
  });

  // --- START ---
  initializeSession();
});

// --- START THE SERVER ---
server.listen(PORT, () => {
  console.log(`🚀 Voice pipeline server listening on :${PORT}`);
});
