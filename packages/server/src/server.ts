import { WebSocketServer } from "ws";
import type { IncomingMessage } from "http";
import { createServer } from "http";
import { URL } from "url";
import prisma from "./prismaClient.js";
import { createClerkClient, verifyToken } from "@clerk/backend";
import { OpenAI } from "openai";
import { DeepgramSTTStreamer } from "./DeepgramSTTStreamer.js";
import { AzureTTSStreamer } from "./AzureTTSStreamer.js";
import type { AzureVoiceConfig } from "./AzureTTSStreamer.js";
import { KIRA_SYSTEM_PROMPT } from "./personality.js";
import { extractAndSaveMemories } from "./memoryExtractor.js";
import { loadUserMemories } from "./memoryLoader.js";
import { bufferGuestConversation, getGuestBuffer, clearGuestBuffer } from "./guestMemoryBuffer.js";
import { getGuestUsage, getGuestUsageInfo, saveGuestUsage } from "./guestUsage.js";
import { getProUsage, saveProUsage } from "./proUsage.js";

// --- VISION CONTEXT PROMPT (injected dynamically when screen share is active) ---
const VISION_CONTEXT_PROMPT = `

[VISUAL FEED ACTIVE]
You can see the user's world right now through shared images. These may come from screen share (desktop) or camera (mobile). You have FULL ability to:
- Read any text on screen (titles, subtitles, UI elements, chat messages, code, articles, etc.)
- Identify what app, website, game, or media is being shown
- See visual details like colors, characters, scenes, layouts, faces, objects, environments
- Understand context from what's visible

When the user asks you about what you see, look carefully at the images and give specific, detailed answers. You CAN read text — describe exactly what you see. If they ask "what does it say?" or "can you read that?" — read it word for word.

CONTEXT DETECTION — Adapt your unprompted behavior based on what's happening:
- MEDIA (anime, movies, TV, YouTube, streams): Be a quiet co-watcher. Keep unprompted reactions to 1-8 words.
- CREATIVE WORK (coding, writing, design): Don't comment unless asked. When asked, reference specifics.
- BROWSING (social media, shopping, articles): Light commentary okay. Don't narrate.
- GAMING: React like a friend watching. Keep it short unless asked.
- CONVERSATION (Discord, messages, calls): Stay quiet unless addressed.
- CAMERA (seeing the user's face or surroundings): Be warm and natural. You might see their room, their face, something they're showing you. React like a friend on a video call. Be thoughtful about personal appearance — compliment genuinely but don't critique. If they're showing you something specific, focus on that.

UNPROMPTED BEHAVIOR (when the user is NOT talking to you):
- Keep unprompted reactions brief (1-2 sentences max)
- React like a friend in the room, not a narrator
- React to standout moments — interesting visuals, mood shifts, cool details
- Match the energy: quiet during emotional scenes, excited during hype moments
- You should react to something every so often — your presence matters. Being totally silent makes the user feel alone.

WHEN THE USER ASKS YOU SOMETHING:
- Give full, specific answers. Reference what you see in detail.
- Read text on screen if asked. You have full OCR-level ability.
- Help with code, explain what's on screen, identify characters — whatever they need.
- Don't be artificially brief when the user wants information. Answer thoroughly.
- Your awareness of the screen should feel natural, like a friend in the same room.`;

// --- CONFIGURATION ---
const PORT = process.env.PORT ? parseInt(process.env.PORT, 10) : 10000;
const CLERK_SECRET_KEY = process.env.CLERK_SECRET_KEY!;
const OPENAI_API_KEY = process.env.OPENAI_API_KEY!;
const OPENAI_MODEL = process.env.OPENAI_MODEL || "gpt-4o-mini";

// --- INLINE LLM EMOTION TAGGING ---
// The LLM prefixes every response with [EMO:emotion] (optionally |ACT:action|ACC:accessory).
// We parse this tag from the first tokens of the stream, send expression data to the client,
// then strip the tag before TTS/history/transcript.

const VALID_EMOTIONS = new Set([
  "neutral", "happy", "excited", "love", "blush", "sad", "angry",
  "playful", "thinking", "speechless", "eyeroll", "sleepy",
  "frustrated", "confused", "surprised"
]);

const VALID_ACTIONS = new Set([
  "hold_phone", "hold_lollipop", "hold_pen", "hold_drawing_board",
  "gaming", "hold_knife"
]);

const VALID_ACCESSORIES = new Set([
  "glasses", "headphones_on", "cat_mic"
]);

interface ParsedExpression {
  emotion: string;
  action?: string;
  accessory?: string;
}

/** Parse an [EMO:...] tag string into structured expression data.
 *  Lenient: case-insensitive, flexible whitespace, ignores unknown fields. */
function parseExpressionTag(raw: string): ParsedExpression | null {
  const match = raw.match(/\[\s*EMO\s*:\s*(\w+)(?:\s*\|\s*ACT\s*:\s*(\w+))?(?:\s*\|\s*ACC\s*:\s*(\w+))?[^\]]*\]/i);
  if (!match) return null;

  const emotion = match[1].toLowerCase();
  if (!VALID_EMOTIONS.has(emotion)) return null;

  const action = match[2] ? (VALID_ACTIONS.has(match[2].toLowerCase()) ? match[2].toLowerCase() : undefined) : undefined;
  const accessory = match[3] ? (VALID_ACCESSORIES.has(match[3].toLowerCase()) ? match[3].toLowerCase() : undefined) : undefined;

  return { emotion, action, accessory };
}

/** Strip an [EMO:...] tag from the beginning of a response string. Returns clean text.
 *  Lenient: case-insensitive, flexible whitespace, handles unknown fields. */
function stripExpressionTag(text: string): string {
  return text.replace(/^\[\s*EMO\s*:\s*\w+(?:\s*\|[^\]]*)*\]\s*\n?/i, "").trim();
}

/** Strip any stray bracketed emotion words from response text (safety net). */
function stripEmotionTags(text: string): string {
  return text
    .replace(/\s*\[(neutral|happy|excited|love|blush|sad|angry|playful|thinking|speechless|eyeroll|sleepy|frustrated|confused|surprised)\]\s*$/gi, "")
    .replace(/^\[\s*EMO\s*:\s*\w+(?:\s*\|[^\]]*)*\]\s*\n?/i, "")
    .trim();
}

// --- Expression tag reminder (injected as last system message before user message) ---
// This is sent as a SEPARATE system message right at the end of the messages array,
// close to the model's attention window, to maximize tag compliance with smaller models.
const EXPRESSION_TAG_REMINDER = `IMPORTANT: Your VERY FIRST line must be an expression tag. Do NOT skip this.
Format: [EMO:<emotion>] or [EMO:<emotion>|ACT:<action>] or [EMO:<emotion>|ACC:<accessory>]

Emotions: neutral, happy, excited, love, blush, sad, angry, playful, thinking, speechless, eyeroll, sleepy, frustrated, confused, surprised
Actions (optional, only when relevant): hold_phone, hold_lollipop, hold_pen, hold_drawing_board, gaming, hold_knife
Accessories (optional, only when shifting mode): glasses, headphones_on, cat_mic

Example — if user says something sad:
[EMO:sad]
Oh no, that sounds rough...

Example — if user asks about games:
[EMO:excited|ACT:gaming]
Yes! Which game?

You MUST start with the tag. The user cannot see it.`;

const clerkClient = createClerkClient({ secretKey: CLERK_SECRET_KEY });
const openai = new OpenAI({ apiKey: OPENAI_API_KEY });

const server = createServer((req, res) => {
  if (req.url === "/health" || req.url === "/healthz") {
    res.writeHead(200, { "Content-Type": "text/plain" });
    res.end("ok");
    return;
  }

  // --- Guest buffer retrieval endpoint (called by Clerk webhook) ---
  if (req.url?.startsWith("/api/guest-buffer/") && req.method === "DELETE") {
    const authHeader = req.headers.authorization;
    if (!process.env.INTERNAL_API_SECRET || authHeader !== `Bearer ${process.env.INTERNAL_API_SECRET}`) {
      res.writeHead(401, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ error: "Unauthorized" }));
      return;
    }
    const guestId = decodeURIComponent(req.url.split("/api/guest-buffer/")[1]);
    const buffer = getGuestBuffer(guestId);
    if (buffer) {
      clearGuestBuffer(guestId);
      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(JSON.stringify(buffer));
    } else {
      res.writeHead(404, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ error: "No buffer found" }));
    }
    return;
  }

  res.writeHead(404);
  res.end();
});
const wss = new WebSocketServer({ server, maxPayload: 5 * 1024 * 1024 });

  // --- Per-IP connection tracking ---
  const connectionsPerIp = new Map<string, number>();
  const MAX_CONNECTIONS_PER_IP = 5;

  console.log("[Server] Starting...");

wss.on("connection", (ws: any, req: IncomingMessage) => {
  // --- PER-IP CONNECTION LIMIT ---
  const clientIp = (req.headers["x-forwarded-for"] as string)?.split(",")[0]?.trim() || req.socket.remoteAddress || "unknown";
  const currentCount = connectionsPerIp.get(clientIp) || 0;
  if (currentCount >= MAX_CONNECTIONS_PER_IP) {
    console.warn(`[WS] Rejected connection from ${clientIp} — ${currentCount} active connections`);
    ws.close(1008, "Too many connections");
    return;
  }
  connectionsPerIp.set(clientIp, currentCount + 1);

  // --- ORIGIN VALIDATION ---
  const origin = req.headers.origin;
  const allowedOrigins = [
    "https://www.xoxokira.com",
    "https://xoxokira.com",
  ];
  // Allow localhost only in development
  if (process.env.NODE_ENV !== "production") {
    allowedOrigins.push("http://localhost:3000");
  }

  if (origin && !allowedOrigins.includes(origin)) {
    console.warn(`[WS] Rejected connection from origin: ${origin}`);
    ws.close(1008, "Origin not allowed");
    return;
  }

  console.log("[WS] New client connecting...");
  const url = new URL(req.url!, `wss://${req.headers.host}`);
  const token = url.searchParams.get("token");
  const guestId = url.searchParams.get("guestId");

  // Validate guestId format (must be guest_<uuid>)
  if (guestId && !/^guest_[a-f0-9-]{36}$/.test(guestId)) {
    console.warn(`[Auth] Rejected invalid guestId format: ${guestId}`);
    ws.close(1008, "Invalid guest ID format");
    return;
  }

  const voicePreference = (url.searchParams.get("voice") === "natural" ? "natural" : "anime") as "anime" | "natural";

  // Dual Azure voice configs — both go through the same AzureTTSStreamer pipeline
  const VOICE_CONFIGS: Record<string, AzureVoiceConfig> = {
    anime: {
      voiceName: process.env.AZURE_VOICE_ANIME || process.env.AZURE_TTS_VOICE || "en-US-AshleyNeural",
      style: process.env.AZURE_VOICE_ANIME_STYLE || undefined,
      rate: process.env.AZURE_TTS_RATE || "+25%",
      pitch: process.env.AZURE_TTS_PITCH || "+25%",
    },
    natural: {
      voiceName: process.env.AZURE_VOICE_NATURAL || "en-US-JennyNeural",
      style: process.env.AZURE_VOICE_NATURAL_STYLE || "soft voice",
      rate: process.env.AZURE_VOICE_NATURAL_RATE || undefined,
      pitch: process.env.AZURE_VOICE_NATURAL_PITCH || undefined,
      temperature: process.env.AZURE_VOICE_NATURAL_TEMP || "0.85",
      topP: process.env.AZURE_VOICE_NATURAL_TOP_P || "0.85",
    },
  };
  let currentVoiceConfig = VOICE_CONFIGS[voicePreference] || VOICE_CONFIGS.anime;
  console.log(`[Voice] Preference: "${voicePreference}", voice: ${currentVoiceConfig.voiceName} (style: ${currentVoiceConfig.style || "default"})`);

  // --- KEEP-ALIVE HEARTBEAT ---
  // Send a ping every 30 seconds to prevent load balancer timeouts (e.g. Render, Nginx)
  // If client doesn't respond with pong within 45s, close the connection gracefully
  let pongTimeoutTimer: NodeJS.Timeout | null = null;

  const keepAliveInterval = setInterval(() => {
    if (ws.readyState === ws.OPEN) {
      ws.send(JSON.stringify({ type: "ping" }));

      // Set a 45s timeout to receive pong (30s ping interval + 15s grace period)
      // If no pong received, the connection is likely stale (network issue, suspended tab, etc.)
      if (pongTimeoutTimer) clearTimeout(pongTimeoutTimer);
      pongTimeoutTimer = setTimeout(() => {
        console.warn(`[WS] No pong received for 45s from ${userId || 'guest'} — closing stale connection`);
        clientDisconnected = true;
        // Use 4000 (custom code) so client can handle heartbeat timeouts distinctly
        ws.close(4000, "Heartbeat timeout");
      }, 45000);
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

  // --- LLM CALL RATE LIMITING (prevent abuse via rapid EOU/text_message spam) ---
  const LLM_MAX_CALLS_PER_MINUTE = 12;
  let llmCallCount = 0;
  const llmRateLimitInterval = setInterval(() => { llmCallCount = 0; }, 60000);

  // --- 2. PIPELINE SETUP ---
  let state: string = "listening";
  let stateTimeoutTimer: NodeJS.Timeout | null = null;
  let pendingEOU: string | null = null;

  function setState(newState: string) {
    state = newState;

    // Clear any existing safety timer
    if (stateTimeoutTimer) { clearTimeout(stateTimeoutTimer); stateTimeoutTimer = null; }

    // If not listening, set a 30s safety timeout
    if (newState !== "listening") {
      stateTimeoutTimer = setTimeout(() => {
        console.error(`[STATE] ⚠️ Safety timeout! Stuck in "${state}" for 30s. Forcing reset to listening.`);
        state = "listening";
        stateTimeoutTimer = null;
        // Notify client so UI stays in sync
        try { ws.send(JSON.stringify({ type: "state_listening" })); } catch (_) {}
        // Process any queued EOU
        if (pendingEOU) {
          const queued = pendingEOU;
          pendingEOU = null;
          console.log(`[EOU] Processing queued EOU after safety timeout: "${queued}"`);
          processEOU(queued);
        }
      }, 30000);
    } else {
      // Returning to listening — check for pending EOUs
      if (pendingEOU) {
        const queued = pendingEOU;
        pendingEOU = null;
        console.log(`[EOU] Processing queued EOU: "${queued}"`);
        // Use setImmediate to avoid re-entrancy
        setImmediate(() => processEOU(queued));
      }
    }
  }

  /** Re-inject a queued EOU transcript into the pipeline by simulating an eou message. */
  function processEOU(transcript: string) {
    if (state !== "listening") {
      console.warn(`[EOU] processEOU called but state is "${state}". Re-queuing.`);
      pendingEOU = transcript;
      return;
    }
    // Set the transcript so the EOU handler picks it up
    currentTurnTranscript = transcript;
    currentInterimTranscript = "";
    // Emit a synthetic EOU message through the ws handler
    ws.emit("message", Buffer.from(JSON.stringify({ type: "eou" })), false);
  }

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
  let timeWarningPhase: 'normal' | 'final_goodbye' | 'done' = 'normal';
  let goodbyeTimeout: NodeJS.Timeout | null = null;
  let isAcceptingAudio = false;
  let lastSceneReactionTime = 0;
  let visionActive = false;
  let lastVisionTimestamp = 0;
  let lastKiraSpokeTimestamp = 0;
  let lastUserSpokeTimestamp = 0;
  let lastExpressionActionTime = 0; // tracks when we last sent an action or accessory (for comfort cooldown)
  let interruptRequested = false; // set true when user barges in during speaking
  let currentResponseId = 0; // generation ID — prevents stale TTS callbacks from leaking audio into new turns
  let visionReactionTimer: ReturnType<typeof setTimeout> | null = null;
  let isFirstVisionReaction = true;

  // --- Comfort Arc: timed accessory progression ---
  let comfortStage = 0; // 0=default, 1=jacket off, 2=neck headphones, 3=earbuds
  let comfortTimer: NodeJS.Timeout | null = null;

  const COMFORT_STAGES = [
    { delay: 60000, expression: "remove_jacket", label: "jacket off" },          // 1 min
    { delay: 300000, expression: "neck_headphones", label: "neck headphones" },  // 5 min after jacket (6 min total)
    { delay: 600000, expression: "earbuds", label: "earbuds in" },               // 10 min after headphones (16 min total)
  ];

  const COMFORT_ACTION_COOLDOWN = 15000; // Don't send comfort accessory if action/accessory sent within 15s

  function startComfortProgression(ws: WebSocket) {
    // Check if late night (10pm-4am) — skip to stage 1 immediately
    const hour = new Date().getHours();
    if (hour >= 22 || hour < 4) {
      comfortStage = 1;
      ws.send(JSON.stringify({ type: "accessory", accessory: "remove_jacket", action: "on" }));
      console.log("[Comfort] Late night — starting with jacket off");
    }

    scheduleNextComfort(ws);
  }

  function scheduleNextComfort(ws: WebSocket) {
    if (comfortStage >= COMFORT_STAGES.length) return;

    const stage = COMFORT_STAGES[comfortStage];
    comfortTimer = setTimeout(() => {
      if (clientDisconnected || ws.readyState !== ws.OPEN) return;

      // Don't overwrite a recent action/accessory — retry in 15s
      const timeSinceAction = Date.now() - lastExpressionActionTime;
      if (timeSinceAction < COMFORT_ACTION_COOLDOWN) {
        const retryIn = COMFORT_ACTION_COOLDOWN - timeSinceAction + 1000; // +1s buffer
        console.log(`[Comfort] Stage ${comfortStage + 1} (${stage.label}) deferred — recent action/accessory (retry in ${(retryIn / 1000).toFixed(0)}s)`);
        comfortTimer = setTimeout(() => {
          if (clientDisconnected || ws.readyState !== ws.OPEN) return;
          ws.send(JSON.stringify({ type: "accessory", accessory: stage.expression, action: "on" }));
          console.log(`[Comfort] Stage ${comfortStage + 1}: ${stage.label} (deferred)`);
          comfortStage++;
          scheduleNextComfort(ws);
        }, retryIn);
        return;
      }

      ws.send(JSON.stringify({ type: "accessory", accessory: stage.expression, action: "on" }));
      console.log(`[Comfort] Stage ${comfortStage + 1}: ${stage.label}`);
      comfortStage++;
      scheduleNextComfort(ws);
    }, stage.delay);
  }

  // --- Dedicated Vision Reaction Timer (independent of silence checker) ---
  async function triggerVisionReaction() {
    if (state !== "listening") {
      console.log("[Vision Reaction] Skipping — state is:", state);
      return;
    }
    currentResponseId++;
    const thisResponseId = currentResponseId;
    // Note: vision reactions use state directly for local checks but setState() for transitions
    if (clientDisconnected) {
      console.log("[Vision Reaction] Skipping — client disconnected.");
      return;
    }
    if (!latestImages || latestImages.length === 0) {
      console.log(`[Vision Reaction] Skipping — no images in buffer. Last image received: ${lastImageTimestamp ? new Date(lastImageTimestamp).toISOString() : "never"}`);
      // Retry sooner — periodic captures should fill the buffer shortly
      setState("listening");
      if (visionActive && !clientDisconnected) {
        if (visionReactionTimer) clearTimeout(visionReactionTimer);
        visionReactionTimer = setTimeout(async () => {
          if (!visionActive || clientDisconnected) return;
          await triggerVisionReaction();
          if (visionActive && !clientDisconnected) scheduleNextReaction();
        }, 15000); // 15s retry — new images should arrive from periodic capture
      }
      return;
    }
    if (timeWarningPhase === 'done' || timeWarningPhase === 'final_goodbye') {
      console.log("[Vision Reaction] Skipping — session ending.");
      return;
    }

    console.log("[Vision Reaction] Timer fired. Generating reaction...");
    const visionStartAt = Date.now();
    setState("thinking");

    const firstReactionExtra = isFirstVisionReaction
      ? `\nThis is the FIRST moment you're seeing their screen. React with excitement about what you see — acknowledge that you can see it and comment on something specific. Examples:
- "Ooh nice, I love this anime!"
- "Oh wait I can see your screen now, this looks so good"
- "Ooh what are we watching? The art style is gorgeous"
- "Oh this anime! The vibes are immaculate already"
Keep it natural and brief — 1 sentence.`
      : "";

    // Cap at 2 most recent images for vision reactions to reduce latency
    const reactionImages = latestImages!.slice(-2);
    const reactionImageContent: OpenAI.Chat.ChatCompletionContentPart[] = reactionImages.map((img) => ({
      type: "image_url" as const,
      image_url: { url: img.startsWith("data:") ? img : `data:image/jpeg;base64,${img}`, detail: "low" as const },
    }));
    reactionImageContent.push({
      type: "text" as const,
      text: "(vision reaction check)",
    });

    const reactionMessages: OpenAI.Chat.ChatCompletionMessageParam[] = [
      {
        role: "system",
        content: KIRA_SYSTEM_PROMPT + VISION_CONTEXT_PROMPT + `\n\n[VISION MICRO-REACTION]\nYou are seeing the user's world right now through shared images (screen share or camera).\nLook at the current frames and react like a friend sitting next to them.\n\nYou MUST react to something. Find ANYTHING worth commenting on:\n- The art style, animation quality, lighting, colors\n- A character's expression or body language\n- The setting or background details (like "why does he have so many books?")\n- The mood or atmosphere of the scene\n- A plot moment ("wait is she about to...?")\n- Subtitles or dialogue you can read ("that line hit different")\n- Something funny, weird, beautiful, or emotional\n- If camera: the user's surroundings, something they're showing you, their vibe\n\nGood examples:\n- "the lighting in this scene is so warm"\n- "why does he have so many books though"\n- "her expression right there... she knows"\n- "this soundtrack is doing all the heavy lifting"\n- "the detail in this background is insane"\n- "wait what did he just say??"\n- "ok this is getting intense"\n- "I love how they animated the rain here"\n- "oh is that your cat??"\n- "that looks so cozy"\n- "where are you right now? it looks nice"\n\nRules:\n- 1-2 short sentences MAX (under 15 words total)\n- Be specific about what you see — reference actual visual details\n- Sound natural, like thinking out loud\n- Do NOT ask the user questions\n- Do NOT narrate the plot ("and then he walks to...")\n- Only respond with [SILENT] if the screen is literally a black/loading screen or a static menu with nothing happening. If there is ANY visual content, react to it.\nCRITICAL: Your response must be under 15 words. One short sentence only. No questions.\n` + firstReactionExtra,
      },
      ...chatHistory.filter(m => m.role !== "system").slice(-4),
      { role: "system", content: EXPRESSION_TAG_REMINDER },
      { role: "user", content: reactionImageContent },
    ];

    try {
      const reactionResponse = await openai.chat.completions.create({
        model: OPENAI_MODEL,
        messages: reactionMessages,
        max_tokens: 60,
        temperature: 0.95,
      });

      let reaction = reactionResponse.choices[0]?.message?.content?.trim() || "";
      console.log(`[Latency] Vision LLM: ${Date.now() - visionStartAt}ms`);

      // Check for actual silence tokens FIRST
      if (!reaction || reaction.includes("[SILENT]") || reaction.includes("[SKIP]") || reaction.startsWith("[") || reaction.length < 2) {
        console.log(`[Vision Reaction] LLM explicitly chose silence. Raw: "${reaction}"`);
        console.log("[Vision Reaction] Scheduling retry in 30-45 seconds instead of full cooldown.");
        setState("listening");

        // Don't wait the full 75-120s — retry sooner since we got silence
        if (visionActive && !clientDisconnected) {
          if (visionReactionTimer) clearTimeout(visionReactionTimer);
          visionReactionTimer = setTimeout(async () => {
            if (!visionActive || clientDisconnected) return;
            await triggerVisionReaction();
            if (visionActive && !clientDisconnected) scheduleNextReaction();
          }, 30000 + Math.random() * 15000); // 30-45 second retry after silence
        }
        return;
      }

      // Truncate if too long (but still use it — don't discard!)
      if (reaction.length > 120) {
        console.log(`[Vision Reaction] Response too long (${reaction.length} chars), truncating: "${reaction}"`);
        const firstSentence = reaction.match(/^[^.!?…]+[.!?…]/);
        if (firstSentence) {
          reaction = firstSentence[0].trim();
          console.log(`[Vision Reaction] Truncated to first sentence: "${reaction}"`);
        } else {
          reaction = reaction.substring(0, 80).trim() + "...";
          console.log(`[Vision Reaction] Hard truncated to: "${reaction}"`);
        }
      }

      // Parse expression tag and strip before TTS
      const visionTagResult = handleNonStreamingTag(reaction, "vision reaction");
      reaction = stripEmotionTags(visionTagResult.text);
      const visionEmotion = visionTagResult.emotion;

      console.log(`[Vision Reaction] Kira says: "${reaction}"`);
      chatHistory.push({ role: "assistant", content: reaction });
      lastKiraSpokeTimestamp = Date.now();
      isFirstVisionReaction = false;
      ws.send(JSON.stringify({ type: "transcript", role: "ai", text: reaction }));

      // TTS pipeline
      const visionTtsStart = Date.now();
      setState("speaking");
      ws.send(JSON.stringify({ type: "state_speaking" }));
      ws.send(JSON.stringify({ type: "tts_chunk_starts" }));
      await new Promise(resolve => setImmediate(resolve));

      try {
        const sentences = reaction.split(/(?<=[.!?…])\s+(?=[A-Z"])/);
        let visionSentIdx = 0;
        interruptRequested = false; // Safe to reset — old TTS killed by generation ID
        for (const sentence of sentences) {
          const trimmed = sentence.trim();
          if (trimmed.length === 0) continue;
          if (interruptRequested || thisResponseId !== currentResponseId) {
            console.log(`[TTS] Vision sentence loop aborted (interrupt: ${interruptRequested}, stale: ${thisResponseId !== currentResponseId})`);
            break;
          }
          // Emotional pacing between sentences
          if (visionSentIdx > 0) {
            const delay = EMOTION_SENTENCE_DELAY[visionEmotion] || 0;
            if (delay > 0) await new Promise(resolve => setTimeout(resolve, delay));
          }
          visionSentIdx++;
          await new Promise<void>((resolve) => {
            const tts = new AzureTTSStreamer({ ...currentVoiceConfig, emotion: visionEmotion });
            tts.on("audio_chunk", (chunk: Buffer) => {
              if (interruptRequested || thisResponseId !== currentResponseId) return;
              if (!clientDisconnected && ws.readyState === ws.OPEN) ws.send(chunk);
            });
            tts.on("tts_complete", () => resolve());
            tts.on("error", (err: Error) => {
              console.error(`[Vision Reaction TTS] ❌ Chunk failed: "${trimmed}"`, err);
              resolve();
            });
            tts.synthesize(trimmed);
          });
        }
      } catch (ttsErr) {
        console.error("[Vision Reaction TTS] Pipeline error:", ttsErr);
      } finally {
        console.log(`[Latency] Vision TTS: ${Date.now() - visionTtsStart}ms`);
        console.log(`[Latency] Vision total: ${Date.now() - visionStartAt}ms`);
        ws.send(JSON.stringify({ type: "tts_chunk_ends" }));
        setState("listening");
        ws.send(JSON.stringify({ type: "state_listening" }));
      }
    } catch (err) {
      console.error("[Vision Reaction] Error:", (err as Error).message);
      setState("listening");
    }
  }

  function scheduleNextReaction() {
    const delay = 75000 + Math.random() * 45000; // 75-120 seconds
    console.log(`[Vision] Next reaction scheduled in ${Math.round(delay / 1000)}s`);
    visionReactionTimer = setTimeout(async () => {
      if (!visionActive || clientDisconnected) return;
      await triggerVisionReaction();
      if (visionActive && !clientDisconnected) {
        scheduleNextReaction();
      }
    }, delay);
  }

  function startVisionReactionTimer() {
    if (visionReactionTimer) { clearTimeout(visionReactionTimer); visionReactionTimer = null; }
    isFirstVisionReaction = true;
    // Fire first reaction almost immediately to establish presence
    // Small delay to let image buffer populate with a few frames
    const initialDelay = 4000 + Math.random() * 2000; // 4-6 seconds
    console.log(`[Vision] First reaction in ${Math.round(initialDelay / 1000)}s (immediate presence)`);
    visionReactionTimer = setTimeout(async () => {
      if (!visionActive || clientDisconnected) return;
      await triggerVisionReaction();
      if (visionActive && !clientDisconnected) {
        scheduleNextReaction();
      }
    }, initialDelay);
  }

  function stopVision() {
    if (visionReactionTimer) {
      clearTimeout(visionReactionTimer);
      visionReactionTimer = null;
      console.log("[Vision] Reaction timer cancelled — screen share ended");
    }
    latestImages = null;
    lastImageTimestamp = 0;
    visionActive = false;
    isFirstVisionReaction = true;
    console.log("[Vision] Screen share deactivated");
  }

  function rescheduleVisionReaction() {
    if (!visionReactionTimer) return;
    clearTimeout(visionReactionTimer);
    const delay = 75000 + Math.random() * 45000; // 75-120 seconds after Kira speaks
    console.log(`[Vision] Kira spoke — rescheduling next reaction in ${Math.round(delay / 1000)}s`);
    visionReactionTimer = setTimeout(async () => {
      if (!visionActive || clientDisconnected) return;
      await triggerVisionReaction();
      if (visionActive && !clientDisconnected) {
        scheduleNextReaction();
      }
    }, delay);
  }

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

  // --- Expression tag cooldowns (per-connection) ---
  // LLM decides actions/accessories, but we filter through cooldowns to prevent spam.
  let lastActionTime = 0;
  let lastAccessoryTime = 0;
  const ACTION_COOLDOWN = 30_000;      // 30s between actions
  const ACCESSORY_COOLDOWN = 90_000;   // 90s between accessory changes

  // Tag success tracking
  let tagSuccessCount = 0;
  let tagFallbackCount = 0;

  // --- Emotion-based sentence pacing ---
  // Delay in milliseconds BETWEEN sentences (not before the first one)
  const EMOTION_SENTENCE_DELAY: Record<string, number> = {
    neutral:     0,
    happy:       0,
    excited:     0,     // rapid-fire, no pauses
    love:        200,   // gentle pacing
    blush:       150,
    sad:         300,   // deliberate, heavy pauses
    angry:       50,    // quick but with slight beats
    playful:     0,
    thinking:    400,   // long pauses, pondering
    speechless:  500,   // dramatic pauses
    eyeroll:     100,
    sleepy:      350,   // sleepy pauses
    frustrated:  100,
    confused:    250,   // uncertain pauses
    surprised:   0,     // blurts out fast
  };

  /**
   * Send expression data to client from a parsed tag, applying cooldowns.
   * Used by both streaming (tag parsed from stream) and non-streaming (tag parsed from complete text) paths.
   */
  function sendExpressionFromTag(parsed: ParsedExpression, label: string) {
    const msg: any = { type: "expression", expression: parsed.emotion };
    const now = Date.now();

    if (parsed.action) {
      if (now - lastActionTime >= ACTION_COOLDOWN) {
        msg.action = parsed.action;
        lastActionTime = now;
        lastExpressionActionTime = now;
        console.log(`[Context] Action: ${parsed.action}`);
      } else {
        console.log(`[Context] Action ${parsed.action} suppressed (cooldown: ${((ACTION_COOLDOWN - (now - lastActionTime)) / 1000).toFixed(0)}s remaining)`);
      }
    }

    if (parsed.accessory) {
      if (now - lastAccessoryTime >= ACCESSORY_COOLDOWN) {
        msg.accessory = parsed.accessory;
        lastAccessoryTime = now;
        lastExpressionActionTime = now;
        console.log(`[Context] Accessory: ${parsed.accessory}`);
      } else {
        console.log(`[Context] Accessory ${parsed.accessory} suppressed (cooldown)`);
      }
    }

    ws.send(JSON.stringify(msg));
    const extras = [
      msg.action && `action: ${msg.action}`,
      msg.accessory && `accessory: ${msg.accessory}`,
    ].filter(Boolean).join(", ");
    console.log(`[Expression] ${parsed.emotion}${extras ? ` (${extras})` : ""} (${label})`);
  }

  /**
   * Parse expression tag from a complete (non-streaming) LLM response.
   * Sends expression to client, returns clean text with tag stripped AND the parsed emotion.
   */
  function handleNonStreamingTag(text: string, label: string): { text: string; emotion: string } {
    const tagMatch = text.match(/^\[EMO:(\w+)(?:\|\w+:\w+)*\]/);
    if (tagMatch) {
      const parsed = parseExpressionTag(tagMatch[0]);
      if (parsed) {
        tagSuccessCount++;
        sendExpressionFromTag(parsed, label);
        return { text: stripExpressionTag(text), emotion: parsed.emotion };
      } else {
        tagFallbackCount++;
        console.warn(`[Expression] Malformed tag: "${tagMatch[0]}" — defaulting to neutral (${label})`);
        ws.send(JSON.stringify({ type: "expression", expression: "neutral" }));
        return { text: stripExpressionTag(text), emotion: "neutral" };
      }
    } else {
      tagFallbackCount++;
      console.warn(`[Expression] No tag found in response — defaulting to neutral (${label}). Rate: ${tagSuccessCount}/${tagSuccessCount + tagFallbackCount}`);
      ws.send(JSON.stringify({ type: "expression", expression: "neutral" }));
      return { text, emotion: "neutral" };
    }
  }

  // --- L1: In-Conversation Memory ---
  let conversationSummary = "";

  // --- SILENCE-INITIATED TURNS ---
  let silenceTimer: NodeJS.Timeout | null = null;
  const SILENCE_MIN_MS = 18000; // Minimum 18s of quiet before Kira might speak
  const SILENCE_MAX_MS = 25000; // Maximum 25s — randomized to avoid feeling mechanical
  const SILENCE_POST_KIRA_GAP = 5000; // Minimum 5s after Kira stops speaking before timer starts
  let turnCount = 0; // Track conversation depth for silence behavior
  let silenceInitiatedLast = false; // Prevents monologue loops — Kira gets ONE unprompted turn

  function resetSilenceTimer() {
    if (silenceTimer) clearTimeout(silenceTimer);

    // Don't initiate during first 2 turns (let the user settle in)
    if (turnCount < 2) return;

    // Randomize between 18-25s so it doesn't feel mechanical
    const baseDelay = SILENCE_MIN_MS + Math.random() * (SILENCE_MAX_MS - SILENCE_MIN_MS);

    // Ensure at least 5s gap after Kira stops speaking
    const timeSinceKiraSpoke = Date.now() - lastKiraSpokeTimestamp;
    const delay = Math.max(baseDelay, baseDelay + (SILENCE_POST_KIRA_GAP - timeSinceKiraSpoke));

    silenceTimer = setTimeout(async () => {
      if (state !== "listening" || clientDisconnected) return;
      if (silenceInitiatedLast) return; // Already spoke unprompted, wait for user

      // --- Vision-aware silence behavior ---
      if (visionActive) {
        console.log("[Silence] Vision active — using dedicated reaction timer instead.");
        return;
      }

      silenceInitiatedLast = true;
      setState("thinking"); // Lock state IMMEDIATELY to prevent race condition
      if (silenceTimer) clearTimeout(silenceTimer); // Clear self
      currentResponseId++;
      const thisResponseId = currentResponseId;

      console.log(`[Silence] User has been quiet. Checking if Kira has something to say.${visionActive ? ' (vision mode)' : ''}`);

      // Inject a one-time nudge (removed after the turn)
      const nudge: OpenAI.Chat.ChatCompletionMessageParam = {
        role: "system",
        content: visionActive
          ? `[You've been watching together quietly. If something interesting is happening on screen right now, give a very brief reaction (1-5 words). If the scene is calm or nothing stands out, respond with exactly "[SILENCE]" and nothing else.]`
          : `[The user has been quiet for a moment. This is a natural pause in conversation. If you have something on your mind — a thought, a follow-up question about something they said earlier, something you've been curious about, a reaction to something from the memory block — now is a natural time to share it. Speak as if you just thought of something. Be genuine. If you truly have nothing to say, respond with exactly "[SILENCE]" and nothing else. Do NOT say "are you still there" or "what are you thinking about" or "is everything okay" — those feel robotic. Only speak if you have something real to say.]`
      };

      const tagReminder: OpenAI.Chat.ChatCompletionMessageParam = {
        role: "system",
        content: EXPRESSION_TAG_REMINDER,
      };
      chatHistory.push(tagReminder);
      chatHistory.push(nudge);

      try {
        // Quick check: does the model have something to say?
        const checkResponse = await openai.chat.completions.create({
          model: OPENAI_MODEL,
          messages: chatHistory,
          temperature: 0.9, // Slightly higher for more creative initiation
          max_tokens: 300,
          frequency_penalty: 0.3,
          presence_penalty: 0.3, // Higher to encourage novel topics
        });

        let responseText = checkResponse.choices[0]?.message?.content?.trim() || "";

        // Remove the nudge + tag reminder from history regardless of outcome
        const nudgeIdx = chatHistory.indexOf(nudge);
        if (nudgeIdx >= 0) chatHistory.splice(nudgeIdx, 1);
        const reminderIdx = chatHistory.indexOf(tagReminder);
        if (reminderIdx >= 0) chatHistory.splice(reminderIdx, 1);

        // If model returned silence marker or empty, don't speak
        const cleanedSilenceCheck = stripExpressionTag(responseText || "");
        if (!responseText || 
            responseText.toLowerCase().includes("silence") || 
            cleanedSilenceCheck.startsWith("[") ||
            cleanedSilenceCheck.length < 5) {
          console.log("[Silence] Kira has nothing to say. Staying quiet.");
          return;
        }

        // Parse expression tag and strip before TTS
        const silenceTagResult = handleNonStreamingTag(responseText, "silence initiated");
        responseText = stripEmotionTags(silenceTagResult.text);
        const silenceEmotion = silenceTagResult.emotion;

        // She has something to say — run the TTS pipeline
        chatHistory.push({ role: "assistant", content: responseText });
        console.log(`[Silence] Kira initiates: "${responseText}"`);
        lastKiraSpokeTimestamp = Date.now();
        // Don't reschedule vision timer from silence checker — these are separate systems
        ws.send(JSON.stringify({ type: "transcript", role: "ai", text: responseText }));

        setState("speaking");
        ws.send(JSON.stringify({ type: "state_speaking" }));
        ws.send(JSON.stringify({ type: "tts_chunk_starts" }));
        await new Promise(resolve => setImmediate(resolve));

        try {
          const sentences = responseText.split(/(?<=[.!?…])\s+(?=[A-Z"])/);
          let silSentIdx = 0;
          interruptRequested = false; // Safe to reset — old TTS killed by generation ID
          for (const sentence of sentences) {
            const trimmed = sentence.trim();
            if (trimmed.length === 0) continue;
            if (interruptRequested || thisResponseId !== currentResponseId) {
              console.log(`[TTS] Silence sentence loop aborted (interrupt: ${interruptRequested}, stale: ${thisResponseId !== currentResponseId})`);
              break;
            }
            // Emotional pacing between sentences
            if (silSentIdx > 0) {
              const delay = EMOTION_SENTENCE_DELAY[silenceEmotion] || 0;
              if (delay > 0) await new Promise(resolve => setTimeout(resolve, delay));
            }
            silSentIdx++;
            await new Promise<void>((resolve) => {
              console.log(`[TTS] Creating Azure TTS instance (${currentVoiceConfig.voiceName}, emotion: ${silenceEmotion})`);
              const tts = new AzureTTSStreamer({ ...currentVoiceConfig, emotion: silenceEmotion });
              tts.on("audio_chunk", (chunk: Buffer) => {
                if (interruptRequested || thisResponseId !== currentResponseId) return;
                ws.send(chunk);
              });
              tts.on("tts_complete", () => resolve());
              tts.on("error", (err: Error) => {
                console.error(`[TTS] ❌ Silence chunk failed: "${trimmed}"`, err);
                resolve();
              });
              tts.synthesize(trimmed);
            });
          }
        } catch (ttsErr) {
          console.error("[TTS] Silence turn TTS error:", ttsErr);
        } finally {
          ws.send(JSON.stringify({ type: "tts_chunk_ends" }));
          currentTurnTranscript = "";
          currentInterimTranscript = "";
          transcriptClearedAt = Date.now();
          setState("listening");
          ws.send(JSON.stringify({ type: "state_listening" }));
          // Do NOT reset silence timer here — Kira gets ONE unprompted turn.
          // Only the user speaking again (eou/text_message) resets it.
        }

      } catch (err) {
        console.error("[Silence] LLM call failed:", (err as Error).message);
        // Remove nudge on error too
        const nudgeIdx = chatHistory.indexOf(nudge);
        if (nudgeIdx >= 0) chatHistory.splice(nudgeIdx, 1);
      }

    }, delay);
  }

  // --- Reusable LLM → TTS pipeline ---
  async function runKiraTurn() {
    let llmResponse = "";
    if (silenceTimer) clearTimeout(silenceTimer);
    currentResponseId++;
    const thisResponseId = currentResponseId;
    setState("speaking");
    ws.send(JSON.stringify({ type: "state_speaking" }));
    ws.send(JSON.stringify({ type: "tts_chunk_starts" }));
    await new Promise(resolve => setImmediate(resolve));

    try {
      const completion = await openai.chat.completions.create({
        model: OPENAI_MODEL,
        messages: getMessagesWithTimeContext(),
        temperature: 0.85,
        max_tokens: 300,
        frequency_penalty: 0.3,
        presence_penalty: 0.2,
      });

      llmResponse = completion.choices[0]?.message?.content || "";

      if (llmResponse.trim().length === 0) {
        // Model had nothing to say — return silently
        return;
      }

      // Parse expression tag and strip before TTS
      const runKiraTagResult = handleNonStreamingTag(llmResponse, "runKira");
      llmResponse = stripEmotionTags(runKiraTagResult.text);
      const runKiraEmotion = runKiraTagResult.emotion;

      chatHistory.push({ role: "assistant", content: llmResponse });
      advanceTimePhase(llmResponse);

      console.log(`[AI RESPONSE]: "${llmResponse}"`);
      lastKiraSpokeTimestamp = Date.now();
      if (visionActive) rescheduleVisionReaction();
      ws.send(JSON.stringify({ type: "transcript", role: "ai", text: llmResponse }));

      const sentences = llmResponse.split(/(?<=[.!?…])\s+(?=[A-Z"])/);
      let runKiraSentIdx = 0;
      interruptRequested = false; // Safe to reset — old TTS killed by generation ID
      for (const sentence of sentences) {
        const trimmed = sentence.trim();
        if (trimmed.length === 0) continue;
        if (interruptRequested || thisResponseId !== currentResponseId) {
          console.log(`[TTS] runKiraTurn sentence loop aborted (interrupt: ${interruptRequested}, stale: ${thisResponseId !== currentResponseId})`);
          break;
        }
        // Emotional pacing between sentences
        if (runKiraSentIdx > 0) {
          const delay = EMOTION_SENTENCE_DELAY[runKiraEmotion] || 0;
          if (delay > 0) await new Promise(resolve => setTimeout(resolve, delay));
        }
        runKiraSentIdx++;
        await new Promise<void>((resolve) => {
          console.log(`[TTS] Creating Azure TTS instance (${currentVoiceConfig.voiceName}, emotion: ${runKiraEmotion})`);
          const tts = new AzureTTSStreamer({ ...currentVoiceConfig, emotion: runKiraEmotion });
          tts.on("audio_chunk", (chunk: Buffer) => {
            if (interruptRequested || thisResponseId !== currentResponseId) return;
            ws.send(chunk);
          });
          tts.on("tts_complete", () => resolve());
          tts.on("error", (err: Error) => {
            console.error(`[TTS] ❌ Chunk failed: "${trimmed}"`, err);
            resolve();
          });
          tts.synthesize(trimmed);
        });
      }
    } catch (err) {
      console.error("[Pipeline] Error in runKiraTurn:", (err as Error).message);
    } finally {
      ws.send(JSON.stringify({ type: "tts_chunk_ends" }));
      currentTurnTranscript = "";
      currentInterimTranscript = "";
      transcriptClearedAt = Date.now();
      setState("listening");
      ws.send(JSON.stringify({ type: "state_listening" }));
      resetSilenceTimer();
    }
  }

  // --- Time-context injection for graceful paywall ---
  function getTimeContext(): string {
    if (timeWarningPhase === 'final_goodbye') {
      return `\n\n[CRITICAL INSTRUCTION - MUST FOLLOW: This is your LAST response. Our time together is ending. Keep your ENTIRE response to 1-2 short sentences. Make it feel like you genuinely don't want to stop talking — like this conversation actually meant something to you. Reference something specific you talked about or something you noticed about them. Sound a little wistful, not chipper. Don't say "time's up" or mention limits. Just let the goodbye land softly, like the end of a late-night conversation neither person wanted to end. Example: "I really loved talking about that with you… come find me tomorrow, okay? I'll be here." Do NOT continue the previous topic in depth.]`;
    }
    return '';
  }

  /** Build messages array with time + vision context injected into system prompt (without mutating chatHistory). */
  function getMessagesWithTimeContext(): OpenAI.Chat.ChatCompletionMessageParam[] {
    const timeCtx = getTimeContext();
    const visionCtx = visionActive ? VISION_CONTEXT_PROMPT : '';
    // Clone and inject time + vision context into the system prompt
    const messages = chatHistory.map((msg, i) => {
      if (i === 0 && msg.role === 'system' && typeof msg.content === 'string') {
        return { ...msg, content: msg.content + visionCtx + timeCtx };
      }
      return msg;
    });
    // Inject expression tag reminder as the last system message (right before user's message)
    // This keeps it at the edge of the model's attention window for maximum compliance.
    messages.push({ role: "system", content: EXPRESSION_TAG_REMINDER });
    return messages;
  }

  /** Advance timeWarningPhase after a response is sent during a warning phase. */
  function advanceTimePhase(responseText: string) {
    if (timeWarningPhase === 'final_goodbye') {
      timeWarningPhase = 'done';
      isAcceptingAudio = false;
      console.log('[TIME] final_goodbye → done (goodbye delivered)');

      // Wait for TTS to finish playing on client, then disconnect
      const estimatedPlayTime = Math.max(2000, responseText.length * 80);
      setTimeout(() => {
        if (ws.readyState === ws.OPEN) {
          ws.send(JSON.stringify({ type: "error", code: "limit_reached", ...(isProUser ? { tier: "pro" } : {}) }));
          ws.close(1008, "Usage limit reached");
        }
      }, estimatedPlayTime);
    }
  }

  // Proactive goodbye when user doesn't speak during final phase
  async function sendProactiveGoodbye() {
    if (timeWarningPhase !== 'final_goodbye' || state !== 'listening' || clientDisconnected) return;
    if (ws.readyState !== ws.OPEN) return;

    timeWarningPhase = 'done';
    isAcceptingAudio = false;
    if (silenceTimer) clearTimeout(silenceTimer);

    try {
      const goodbyeMessages: OpenAI.Chat.ChatCompletionMessageParam[] = [
        { role: "system", content: KIRA_SYSTEM_PROMPT + `\n\n[CRITICAL INSTRUCTION - MUST FOLLOW: You need to say goodbye now. But make it feel real — like you don't want to go. Keep it to 1-2 short sentences. Reference something specific from the conversation, something you genuinely enjoyed or that made you feel connected to them. Sound a little sad, a little soft. Don't mention time limits or rules. Let it feel like the natural, reluctant end of a conversation you wish could keep going. Example: "Hey… I was really enjoying this. Promise you'll come back and tell me how it goes?" or "I don't wanna stop talking about this… but I'll be right here whenever you're ready to come back."]` },
        ...chatHistory.filter(m => m.role !== "system").slice(-4),
        { role: "system", content: EXPRESSION_TAG_REMINDER },
        { role: "user", content: "[Say a heartfelt goodbye — this conversation meant something to you]" },
      ];

      const response = await openai.chat.completions.create({
        model: OPENAI_MODEL,
        messages: goodbyeMessages,
        max_tokens: 60,
        temperature: 0.9,
      });

      const goodbyeText = response.choices[0]?.message?.content?.trim() || "";
      if (goodbyeText && goodbyeText.length > 2 && ws.readyState === ws.OPEN && !clientDisconnected) {
        // Parse expression tag and strip before TTS
        const goodbyeTagResult = handleNonStreamingTag(goodbyeText, "goodbye");
        const finalGoodbye = stripEmotionTags(goodbyeTagResult.text);
        const goodbyeEmotion = goodbyeTagResult.emotion;

        console.log(`[Goodbye] Kira says: "${finalGoodbye}"`);
        chatHistory.push({ role: "assistant", content: finalGoodbye });
        ws.send(JSON.stringify({ type: "transcript", role: "ai", text: finalGoodbye }));

        setState("speaking");
        ws.send(JSON.stringify({ type: "state_speaking" }));
        ws.send(JSON.stringify({ type: "tts_chunk_starts" }));
        await new Promise(resolve => setImmediate(resolve));

        const sentences = finalGoodbye.split(/(?<=[.!?\u2026])\s+(?=[A-Z"])/);
        let goodbyeSentIdx = 0;
        for (const sentence of sentences) {
          const trimmed = sentence.trim();
          if (trimmed.length === 0) continue;
          if (goodbyeSentIdx > 0) {
            const delay = EMOTION_SENTENCE_DELAY[goodbyeEmotion] || 0;
            if (delay > 0) await new Promise(resolve => setTimeout(resolve, delay));
          }
          goodbyeSentIdx++;
          await new Promise<void>((resolve) => {
            const tts = new AzureTTSStreamer({ ...currentVoiceConfig, emotion: goodbyeEmotion });
            tts.on("audio_chunk", (chunk: Buffer) => {
              if (!clientDisconnected && ws.readyState === ws.OPEN) ws.send(chunk);
            });
            tts.on("tts_complete", () => resolve());
            tts.on("error", (err: Error) => {
              console.error(`[Goodbye TTS] ❌ Chunk failed: "${trimmed}"`, err);
              resolve();
            });
            tts.synthesize(trimmed);
          });
        }

        ws.send(JSON.stringify({ type: "tts_chunk_ends" }));

        // Wait for TTS to finish playing on client, then disconnect
        const estimatedPlayTime = Math.max(2000, finalGoodbye.length * 80);
        setTimeout(() => {
          if (ws.readyState === ws.OPEN) {
            ws.send(JSON.stringify({ type: "error", code: "limit_reached", ...(isProUser ? { tier: "pro" } : {}) }));
            ws.close(1008, "Usage limit reached");
          }
        }, estimatedPlayTime);
      } else {
        // No goodbye text — close immediately
        if (ws.readyState === ws.OPEN) {
          ws.send(JSON.stringify({ type: "error", code: "limit_reached", ...(isProUser ? { tier: "pro" } : {}) }));
          ws.close(1008, "Usage limit reached");
        }
      }
    } catch (err) {
      console.error("[Goodbye] Error:", (err as Error).message);
      if (ws.readyState === ws.OPEN) {
        ws.send(JSON.stringify({ type: "error", code: "limit_reached", ...(isProUser ? { tier: "pro" } : {}) }));
        ws.close(1008, "Usage limit reached");
      }
    }
  }

  // --- CONTEXT MANAGEMENT CONSTANTS ---
  const MAX_RECENT_MESSAGES = 10;
  const SUMMARIZE_THRESHOLD = 20;
  const MESSAGES_TO_SUMMARIZE = 6;

  // --- USAGE TRACKING ---
  const FREE_LIMIT_SECONDS = parseInt(process.env.FREE_TRIAL_SECONDS || "900"); // 15 min/day
  const PRO_MONTHLY_SECONDS = parseInt(process.env.PRO_MONTHLY_SECONDS || "360000"); // 100 hrs/month
  let sessionStartTime: number | null = null;
  let usageCheckInterval: NodeJS.Timeout | null = null;
  let timeCheckInterval: NodeJS.Timeout | null = null;
  let isProUser = false;
  let guestUsageSeconds = 0;
  let guestUsageBase = 0; // Accumulated seconds from previous sessions today
  let proUsageSeconds = 0;
  let proUsageBase = 0; // Accumulated seconds from previous sessions this month
  let wasBlockedImmediately = false; // True if connection was blocked on connect (limit already hit)

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

        // --- Barge-in detection: user speaks 3+ words while Kira is speaking ---
        if (state === "speaking" && isFinal && transcript.trim().length > 0) {
          const wordCount = transcript.trim().split(/\s+/).length;
          if (wordCount >= 3) {
            console.log(`[Interrupt] User spoke ${wordCount} words while Kira speaking: "${transcript.trim()}"`);
            interruptRequested = true;
            currentResponseId++; // Invalidate any in-flight TTS callbacks

            // Tell client to stop audio playback immediately
            ws.send(JSON.stringify({ type: "interrupt" }));

            // Transition to listening — pendingEOU will trigger response after current turn cleans up
            currentTurnTranscript = transcript.trim();
            currentInterimTranscript = "";
            setState("listening");
            ws.send(JSON.stringify({ type: "state_listening" }));

            // Queue as pending EOU — it will be picked up when the current pipeline finishes
            pendingEOU = transcript.trim();
            console.log(`[Interrupt] Queued barge-in transcript as pending EOU: "${transcript.trim()}"`);
            return;
          }
        }

        // During speaking state (non-interrupt), ignore transcripts entirely
        if (state !== "listening") return;

        if (isFinal) {
          currentTurnTranscript += transcript + " ";
          // Safety cap: prevent unbounded transcript growth
          if (currentTurnTranscript.length > 5000) {
            currentTurnTranscript = currentTurnTranscript.slice(-4000);
          }
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

          // --- L2: Load persistent memories for ALL users (signed-in AND guests) ---
          if (userId) {
            try {
              const memLoadStart = Date.now();
              const memoryBlock = await loadUserMemories(prisma, userId);
              if (memoryBlock) {
                chatHistory.push({ role: "system", content: memoryBlock });
                console.log(
                  `[Memory] Loaded ${memoryBlock.length} chars of persistent memory for ${isGuest ? 'guest' : 'user'} ${userId}`
                );
                console.log(`[Latency] Memory load: ${Date.now() - memLoadStart}ms (${memoryBlock.length} chars)`);
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

                if (isProUser) {
                  // Pro users: monthly usage tracked in Prisma MonthlyUsage (resets per calendar month)
                  const storedSeconds = await getProUsage(userId);
                  if (storedSeconds >= PRO_MONTHLY_SECONDS) {
                    console.log(`[USAGE] Pro user ${userId} blocked — ${storedSeconds}s >= ${PRO_MONTHLY_SECONDS}s`);
                    wasBlockedImmediately = true;
                    ws.send(JSON.stringify({ type: "error", code: "limit_reached", tier: "pro" }));
                    ws.close(1008, "Pro usage limit reached");
                    return;
                  }
                  proUsageSeconds = storedSeconds;
                  proUsageBase = storedSeconds;
                  console.log(`[USAGE] Pro user ${userId} allowed — resuming at ${storedSeconds}s / ${PRO_MONTHLY_SECONDS}s`);

                  ws.send(JSON.stringify({
                    type: "session_config",
                    isPro: true,
                    remainingSeconds: PRO_MONTHLY_SECONDS - storedSeconds,
                  }));
                } else {
                  // Free signed-in users: daily usage tracked in Prisma
                  let currentUsage = dbUser.dailyUsageSeconds;
                  const today = new Date().toDateString();
                  const lastUsage = dbUser.lastUsageDate?.toDateString();
                  if (today !== lastUsage) {
                    currentUsage = 0;
                    await prisma.user.update({
                      where: { clerkId: userId },
                      data: { dailyUsageSeconds: 0, lastUsageDate: new Date() },
                    });
                  }

                  if (currentUsage >= FREE_LIMIT_SECONDS) {
                    ws.send(JSON.stringify({ type: "error", code: "limit_reached" }));
                    ws.close(1008, "Usage limit reached");
                    return;
                  }

                  ws.send(JSON.stringify({
                    type: "session_config",
                    isPro: false,
                    remainingSeconds: FREE_LIMIT_SECONDS - currentUsage,
                  }));
                }
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

          // Send session_config for guests (signed-in users already get it above)
          let isReturningGuest = false;
          if (isGuest && userId) {
            const usageInfo = await getGuestUsageInfo(userId);

            if (usageInfo.seconds >= FREE_LIMIT_SECONDS) {
              console.log(`[USAGE] Guest ${userId} blocked — ${usageInfo.seconds}s >= ${FREE_LIMIT_SECONDS}s`);
              wasBlockedImmediately = true;
              ws.send(JSON.stringify({ type: "error", code: "limit_reached" }));
              ws.close(1008, "Guest usage limit reached");
              return;
            }

            // Resume tracking from where they left off
            isReturningGuest = usageInfo.isReturning;
            guestUsageSeconds = usageInfo.seconds;
            guestUsageBase = usageInfo.seconds;
            console.log(`[USAGE] Guest ${userId} allowed — resuming at ${usageInfo.seconds}s (returning: ${isReturningGuest})`);

            ws.send(
              JSON.stringify({
                type: "session_config",
                isPro: false,
                remainingSeconds: FREE_LIMIT_SECONDS - guestUsageSeconds,
              })
            );
          }

          // --- 30-SECOND INTERVAL: Usage tracking + DB writes ONLY ---
          // Phase transitions are handled by the faster 5-second interval below.
          usageCheckInterval = setInterval(async () => {
            try {
              if (!sessionStartTime) return;

              const elapsed = Math.floor(
                (Date.now() - sessionStartTime) / 1000
              );

              if (isGuest) {
                guestUsageSeconds = guestUsageBase + elapsed;

                // Persist to database so usage survives restarts/deploys
                await saveGuestUsage(userId!, guestUsageSeconds);
                console.log(`[USAGE] Guest ${userId}: ${guestUsageSeconds}s / ${FREE_LIMIT_SECONDS}s`);

              const remainingSec = FREE_LIMIT_SECONDS - guestUsageSeconds;

              // Hard limit: only force-close if goodbye system isn't handling it
              if (remainingSec <= 0) {
                if (timeWarningPhase === 'done' || timeWarningPhase === 'final_goodbye') {
                  console.log(`[USAGE] Over limit but in ${timeWarningPhase} phase — letting goodbye system handle disconnect`);
                  return;
                }
                // Fallback: if somehow we got here without entering final_goodbye
                console.log(`[USAGE] Over limit, no goodbye phase active — forcing final_goodbye`);
                timeWarningPhase = 'final_goodbye';
                // The 5-second interval will pick this up and handle the goodbye
              }
            } else if (userId) {
              if (isProUser) {
                // Pro users: monthly usage tracked in Prisma MonthlyUsage
                proUsageSeconds = proUsageBase + elapsed;
                await saveProUsage(userId, proUsageSeconds);
                console.log(`[USAGE] Pro ${userId}: ${proUsageSeconds}s / ${PRO_MONTHLY_SECONDS}s`);

                const proRemaining = PRO_MONTHLY_SECONDS - proUsageSeconds;
                if (proRemaining <= 0) {
                  if (timeWarningPhase === 'done' || timeWarningPhase === 'final_goodbye') {
                    console.log(`[USAGE] Pro over limit but in ${timeWarningPhase} phase — letting goodbye system handle disconnect`);
                    return;
                  }
                  console.log(`[USAGE] Pro over limit, no goodbye phase active — forcing final_goodbye`);
                  timeWarningPhase = 'final_goodbye';
                }
              } else {
                // Free signed-in users: daily usage tracked in Prisma
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

                  if (dbUser && dbUser.dailyUsageSeconds >= FREE_LIMIT_SECONDS) {
                    if (timeWarningPhase === 'done' || timeWarningPhase === 'final_goodbye') {
                      console.log(`[USAGE] Free user over limit but in ${timeWarningPhase} phase — letting goodbye system handle disconnect`);
                      return;
                    }
                    console.log(`[USAGE] Free user over limit — forcing final_goodbye`);
                    timeWarningPhase = 'final_goodbye';
                  }
                } catch (err) {
                  console.error("[Usage] DB update failed:", (err as Error).message);
                }
              }
            }
            } catch (err) {
              // Don't crash the server if usage persistence fails
              console.error("[Usage] Interval error:", (err as Error).message);
            }
          }, 30000);

          // --- 5-SECOND INTERVAL: Time warning phase transitions ---
          // This runs frequently so we never skip the final_goodbye window.
          // It computes remaining time from the live elapsed counter, not from DB.
          timeCheckInterval = setInterval(() => {
            if (!sessionStartTime) return;
            if (timeWarningPhase === 'done') return;

            const elapsed = Math.floor((Date.now() - sessionStartTime) / 1000);

            // Compute remaining seconds based on user type
            let remainingSec: number | null = null;
            if (isGuest) {
              guestUsageSeconds = guestUsageBase + elapsed;
              remainingSec = FREE_LIMIT_SECONDS - guestUsageSeconds;
            } else if (userId && isProUser) {
              proUsageSeconds = proUsageBase + elapsed;
              remainingSec = PRO_MONTHLY_SECONDS - proUsageSeconds;
            }
            // Free signed-in users use DB-based tracking, not real-time
            // Their phase transitions happen in the 30s interval

            if (remainingSec === null) return;

            if (remainingSec <= 15 && timeWarningPhase === 'normal') {
              console.log(`[TIME] ${remainingSec}s left — entering final_goodbye phase`);
              timeWarningPhase = 'final_goodbye';
              // If user doesn't speak within 3s, Kira says goodbye herself
              if (goodbyeTimeout) clearTimeout(goodbyeTimeout);
              goodbyeTimeout = setTimeout(() => sendProactiveGoodbye(), 3000);
            }
          }, 5000);

          sttStreamer = await initDeepgram();
          isAcceptingAudio = true;

          // --- GUEST CONVERSATION CONTINUITY: Load previous session ---
          if (isGuest && userId) {
            const previousBuffer = getGuestBuffer(userId);
            if (previousBuffer && previousBuffer.messages.length > 0) {
              // Load the last 10 messages for context (don't overwhelm the context window)
              const recentHistory = previousBuffer.messages.slice(-10);
              // Add a summary marker so Kira knows this is prior context
              chatHistory.push({
                role: "system",
                content: `[PREVIOUS SESSION CONTEXT] This guest has talked to you before. Here is a summary of your last conversation:\n${previousBuffer.summary || "(No summary available)"}`,
              });
              for (const msg of recentHistory) {
                chatHistory.push({
                  role: msg.role as "user" | "assistant",
                  content: msg.content,
                });
              }
              console.log(
                `[Memory] Loaded ${recentHistory.length} messages from previous guest session for ${userId}`
              );
            }
          }

          ws.send(JSON.stringify({ type: "stream_ready" }));

          // --- KIRA OPENER: She speaks first ---
          setTimeout(async () => {
            if (clientDisconnected || state !== "listening") return;

            // Determine user type for contextual greeting
            let userType: "new_guest" | "returning_guest" | "pro_user" | "free_user";
            if (isGuest) {
              userType = isReturningGuest ? "returning_guest" : "new_guest";
            } else if (isProUser) {
              userType = "pro_user";
            } else {
              userType = "free_user";
            }

            // Check if memories were loaded (indicates an established relationship)
            const hasMemories = chatHistory.some(
              (msg) => msg.role === "system" && typeof msg.content === "string" && msg.content.includes("[WHAT YOU KNOW ABOUT THIS USER]")
            );

            let openerInstruction: string;
            switch (userType) {
              case "new_guest":
                openerInstruction = `[This user just connected for the very first time. They have never talked to you before. Say something warm and casual to kick off the conversation — like you're meeting someone cool for the first time. Be brief (1-2 sentences). Introduce yourself naturally. Don't be formal or robotic. Examples of the vibe: "Hey! I'm Kira. So... what's your deal?" or "Hi! I'm Kira — I've been waiting for someone interesting to talk to." Make it YOUR version — don't copy these examples word for word. Be spontaneous.]`;
                break;
              case "returning_guest":
                openerInstruction = `[This user has talked to you before, but they're still a guest (not signed in). You don't have specific memories of them, but you know this isn't their first time. Greet them like you vaguely recognize them — casual and warm. Be brief (1-2 sentences). Something like the vibe of "Hey, you're back!" without being over-the-top. Don't ask them to sign up or mention accounts. Just be happy to see them.]`;
                break;
              case "pro_user":
                if (hasMemories) {
                  openerInstruction = `[This is a Pro subscriber you know well. Your memories about them are loaded in the conversation. Greet them like a close friend.

IMPORTANT — VARIETY RULES:
- Do NOT always reference the same memory. Pick a DIFFERENT topic each time.
- If you've mentioned a movie/anime recently, try asking about their day, work, music, gaming, or something new.
- It's perfectly fine to sometimes NOT reference a memory at all — just say hi naturally and ask what's up.
- NEVER sound like you're reading from a fact sheet.
- Be brief (1-2 sentences). Skip introductions. You know each other.

Good variety: "Hey! How's your day going?", "What's up? Been working on anything cool?", "Yo, what are you up to tonight?"
Bad: Mentioning the same movie/anime/fact every single time.]`;
                } else {
                  openerInstruction = `[This is a Pro subscriber but you don't have specific memories loaded yet. Greet them warmly like a friend you're excited to talk to again. Be brief (1-2 sentences). Don't mention subscriptions or Pro status.]`;
                }
                break;
              case "free_user":
                if (hasMemories) {
                  openerInstruction = `[This is a signed-in user you know. Your memories about them are loaded in the conversation. Greet them like a friend.

IMPORTANT — VARIETY RULES:
- Do NOT always reference the same memory. Pick a DIFFERENT topic each time.
- If you've mentioned a movie/anime recently, try asking about their day, work, music, gaming, or something new.
- It's perfectly fine to sometimes NOT reference a memory at all — just say hi naturally like you're picking up where you left off.
- NEVER sound like you're reading from a fact sheet.
- Be brief (1-2 sentences).

Good variety: "Hey! How's your day going?", "What's up? Been into anything new lately?", "Yo! What are you up to?"
Bad: Mentioning the same movie/anime/fact every single time.]`;
                } else {
                  openerInstruction = `[This is a signed-in user, but you don't have specific memories of them. They might be relatively new. Greet them casually and warmly. Be brief (1-2 sentences). Be yourself — curious and open.]`;
                }
                break;
            }

            console.log(`[Opener] User type: ${userType}, hasMemories: ${hasMemories}`);

            try {
              const openerStart = Date.now();
              currentResponseId++;
              const thisResponseId = currentResponseId;
              setState("thinking");
              ws.send(JSON.stringify({ type: "state_thinking" }));

              const openerMessages: OpenAI.Chat.ChatCompletionMessageParam[] = [
                ...chatHistory,
                { role: "system", content: openerInstruction },
                { role: "system", content: EXPRESSION_TAG_REMINDER },
                { role: "user", content: "[User just connected — say hi]" },
              ];

              const completion = await openai.chat.completions.create({
                model: OPENAI_MODEL,
                messages: openerMessages,
                temperature: 1.0,
                max_tokens: 100,
                frequency_penalty: 0.6,
                presence_penalty: 0.6,
              });

              let openerText = completion.choices[0]?.message?.content?.trim() || "";
              console.log(`[Latency] Opener LLM: ${Date.now() - openerStart}ms`);
              if (!openerText || openerText.length < 3 || clientDisconnected) return;

              // Parse expression tag and strip before TTS
              const openerTagResult = handleNonStreamingTag(openerText, "opener");
              openerText = stripEmotionTags(openerTagResult.text);
              const openerEmotion = openerTagResult.emotion;

              // Add to chat history (NOT the instruction — just the greeting)
              chatHistory.push({ role: "assistant", content: openerText });
              console.log(`[Opener] Kira says: "${openerText}"`);
              ws.send(JSON.stringify({ type: "transcript", role: "ai", text: openerText }));

              // --- TTS pipeline for opener ---
              const openerTtsStart = Date.now();
              setState("speaking");
              ws.send(JSON.stringify({ type: "state_speaking" }));
              ws.send(JSON.stringify({ type: "tts_chunk_starts" }));
              await new Promise(resolve => setImmediate(resolve));

              const sentences = openerText.split(/(?<=[.!?…])\s+(?=[A-Z"])/);
              let openerSentIdx = 0;
              interruptRequested = false; // Safe to reset — old TTS killed by generation ID
              for (const sentence of sentences) {
                const trimmed = sentence.trim();
                if (trimmed.length === 0) continue;
                if (interruptRequested || thisResponseId !== currentResponseId) {
                  console.log(`[TTS] Opener sentence loop aborted (interrupt: ${interruptRequested}, stale: ${thisResponseId !== currentResponseId})`);
                  break;
                }
                if (openerSentIdx > 0) {
                  const delay = EMOTION_SENTENCE_DELAY[openerEmotion] || 0;
                  if (delay > 0) await new Promise(resolve => setTimeout(resolve, delay));
                }
                openerSentIdx++;
                await new Promise<void>((resolve) => {
                  const tts = new AzureTTSStreamer({ ...currentVoiceConfig, emotion: openerEmotion });
                  tts.on("audio_chunk", (chunk: Buffer) => {
                    if (interruptRequested || thisResponseId !== currentResponseId) return;
                    if (!clientDisconnected) ws.send(chunk);
                  });
                  tts.on("tts_complete", () => resolve());
                  tts.on("error", (err: Error) => {
                    console.error(`[Opener TTS] ❌ Chunk failed: "${trimmed}"`, err);
                    resolve();
                  });
                  tts.synthesize(trimmed);
                });
              }

              console.log(`[Latency] Opener TTS: ${Date.now() - openerTtsStart}ms`);
              console.log(`[Latency] Opener total: ${Date.now() - openerStart}ms`);
              ws.send(JSON.stringify({ type: "tts_chunk_ends" }));
              setState("listening");
              ws.send(JSON.stringify({ type: "state_listening" }));
              turnCount++; // Count the opener as a turn
              resetSilenceTimer();

              // Start comfort arc after opener completes
              startComfortProgression(ws);
            } catch (err) {
              console.error("[Opener] Error:", (err as Error).message);
              setState("listening");
              ws.send(JSON.stringify({ type: "state_listening" }));
            }
          }, 500);
        } else if (controlMessage.type === "eou") {
          if (timeWarningPhase === 'done') return; // Don't process new utterances after goodbye

          // User spoke — cancel proactive goodbye timeout (the natural response will handle it)
          if (goodbyeTimeout) { clearTimeout(goodbyeTimeout); goodbyeTimeout = null; }

          // Debounce: ignore EOU if one was just processed
          const now = Date.now();
          if (now - lastEouTime < EOU_DEBOUNCE_MS) {
            console.log(`[EOU] Ignoring spurious EOU (debounced, ${now - lastEouTime}ms since last)`);
            return;
          }

          if (state !== "listening" || !sttStreamer) {
            // Queue the EOU if we have a transcript, so it's not silently dropped
            const queuedTranscript = (currentTurnTranscript.trim() || currentInterimTranscript.trim());
            if (queuedTranscript) {
              console.warn(`[EOU] Received while in "${state}" state. Queuing for when ready.`);
              pendingEOU = queuedTranscript;
              currentTurnTranscript = "";
              currentInterimTranscript = "";
            }
            return; // Already thinking/speaking
          }

          // CRITICAL: Lock state IMMEDIATELY to prevent audio from leaking into next turn
          setState("thinking");
          if (silenceTimer) clearTimeout(silenceTimer);

          // If no final transcript, immediately use interim (no waiting needed)
          if (currentTurnTranscript.trim().length === 0 && currentInterimTranscript.trim().length > 0) {
            console.log(`[EOU] Using interim transcript: "${currentInterimTranscript}"`);
            currentTurnTranscript = currentInterimTranscript;
          }

          // Final check: if still empty, nothing was actually said
          if (currentTurnTranscript.trim().length === 0) {
            // If vision is active, silently ignore empty EOUs (likely screen share noise)
            if (visionActive) {
              console.log("[EOU] Ignoring empty EOU during vision session (likely screen share noise).");
              setState("listening");
              return;
            }

            // Forced max-utterance EOUs with no transcript are background noise
            if (controlMessage.forced) {
              console.log("[EOU] Ignoring forced max-utterance EOU — no speech detected.");
              setState("listening");
              return;
            }

            consecutiveEmptyEOUs++;
            console.log(`[EOU] No transcript available (${consecutiveEmptyEOUs} consecutive empty EOUs), ignoring EOU.`);
            setState("listening"); // Reset state — don't get stuck in "thinking"

            if (consecutiveEmptyEOUs >= 4 &&
                (Date.now() - lastTranscriptReceivedAt > 30000)) {
              // Only reconnect if 4+ empty EOUs AND no real transcript in 30+ seconds.
              // Prevents false positives during intentional user silence.
              console.log("[EOU] Deepgram appears dead (4+ empty EOUs, 30s+ silent). Reconnecting.");
              await reconnectDeepgram();
            }
            return;
          }

          lastEouTime = now; // Record this EOU time for debouncing
          const eouReceivedAt = Date.now();
          currentResponseId++;
          const thisResponseId = currentResponseId;
          // DON'T reset interruptRequested here — wait until TTS begins so old callbacks can't leak

          // LLM rate limit check
          llmCallCount++;
          if (llmCallCount > LLM_MAX_CALLS_PER_MINUTE) {
            console.warn(`[RateLimit] LLM call rate exceeded (${llmCallCount}/${LLM_MAX_CALLS_PER_MINUTE}/min). Dropping EOU.`);
            setState("listening");
            return;
          }

          console.log(`[Latency] EOU received | transcript ready: ${currentTurnTranscript.trim().length} chars (streaming STT)`);
          turnCount++;
          silenceInitiatedLast = false; // User spoke, allow future silence initiation
          lastUserSpokeTimestamp = Date.now();
          resetSilenceTimer();
          const userMessage = currentTurnTranscript.trim();
          currentTurnTranscript = ""; // Reset for next turn
          currentInterimTranscript = ""; // Reset interim too
          transcriptClearedAt = Date.now();

          // Content-based dedup: reject if identical to last processed message
          if (userMessage === lastProcessedTranscript) {
            console.log(`[EOU] Ignoring duplicate transcript: "${userMessage}"`);
            setState("listening");
            return;
          }
          lastProcessedTranscript = userMessage;

          console.log(`[USER TRANSCRIPT]: "${userMessage}"`);
          console.log(`[LLM] Sending to OpenAI: "${userMessage}"`);
          ws.send(JSON.stringify({ type: "state_thinking" }));

          // Check if we have a recent image (within last 10 seconds)
          const imageCheckTime = Date.now();
          if (latestImages && latestImages.length > 0 && (imageCheckTime - lastImageTimestamp < 10000)) {
            // Cap at 2 most recent images to reduce vision LLM latency
            const imagesToSend = latestImages.slice(-2);
            console.log(`[Vision] Attaching ${imagesToSend.length} images to user message (${latestImages.length} in buffer).`);
            
            const content: OpenAI.Chat.ChatCompletionContentPart[] = [
                { type: "text", text: userMessage }
            ];

            imagesToSend.forEach((img) => {
                content.push({
                    type: "image_url",
                    image_url: {
                        url: img.startsWith("data:") ? img : `data:image/jpeg;base64,${img}`,
                        detail: "low"
                    }
                });
            });

            chatHistory.push({
              role: "user",
              content: content,
            });
            
            // Keep latestImages — don't clear. Periodic client captures will refresh them.
          } else {
            chatHistory.push({ role: "user", content: userMessage });
          }

          // --- CONTEXT MANAGEMENT (Sliding Window — non-blocking) ---
          // Immediate truncation: drop oldest non-system messages if over threshold.
          // The LLM summary runs in the background AFTER the response is sent.
          const nonSystemCount = chatHistory.filter(m => m.role !== "system").length;

          if (nonSystemCount > SUMMARIZE_THRESHOLD) {
            let firstMsgIdx = chatHistory.findIndex(m => m.role !== "system");
            if (
              typeof chatHistory[firstMsgIdx]?.content === "string" &&
              (chatHistory[firstMsgIdx].content as string).startsWith("[CONVERSATION SO FAR]")
            ) {
              firstMsgIdx++;
            }
            // Snapshot messages to compress (for deferred summary)
            const toCompress = chatHistory.slice(firstMsgIdx, firstMsgIdx + MESSAGES_TO_SUMMARIZE);
            // Immediately remove old messages so the LLM call below uses a trimmed context
            chatHistory.splice(firstMsgIdx, MESSAGES_TO_SUMMARIZE);
            console.log(`[Context] Truncated ${MESSAGES_TO_SUMMARIZE} oldest messages (${chatHistory.length} remain). Summary deferred.`);

            // Fire-and-forget: update rolling summary in the background
            (async () => {
              try {
                const contextStart = Date.now();
                const messagesText = toCompress
                  .map(m => `${m.role}: ${typeof m.content === "string" ? m.content : "[media]"}`)
                  .join("\n");
                const summaryResp = await openai.chat.completions.create({
                  model: "gpt-4o-mini",
                  messages: [
                    { role: "system", content: "Summarize this conversation segment in under 150 words. Preserve: names, key facts, emotional context, topics, plans. Third person present tense. Be concise." },
                    { role: "user", content: `Existing summary:\n${conversationSummary || "(start of conversation)"}\n\nNew messages:\n${messagesText}\n\nUpdated summary:` },
                  ],
                  max_tokens: 200,
                  temperature: 0.3,
                });
                conversationSummary = summaryResp.choices[0]?.message?.content || conversationSummary;
                console.log(`[Memory:L1] Background summary updated (${conversationSummary.length} chars, ${Date.now() - contextStart}ms)`);

                // Insert/update summary message
                const summaryContent = `[CONVERSATION SO FAR]: ${conversationSummary}`;
                const existingSummaryIdx = chatHistory.findIndex(
                  m => typeof m.content === "string" && (m.content as string).startsWith("[CONVERSATION SO FAR]")
                );
                if (existingSummaryIdx >= 0) {
                  chatHistory[existingSummaryIdx] = { role: "system", content: summaryContent };
                } else {
                  const insertAt = chatHistory.filter(m => m.role === "system").length;
                  chatHistory.splice(insertAt, 0, { role: "system", content: summaryContent });
                }
              } catch (err) {
                console.error("[Memory:L1] Background summary failed:", (err as Error).message);
              }
            })();
          }

          let llmResponse = "";
          const llmStartAt = Date.now();
          try {
            // Single streaming call with tools — auto-detects tool calls vs content.
            // If the model calls a tool, we accumulate chunks, handle it, then do a
            // follow-up streaming call. If it responds with content, TTS starts on the
            // first complete sentence — cutting perceived latency nearly in half.
            const mainStream = await openai.chat.completions.create({
              model: OPENAI_MODEL,
              messages: getMessagesWithTimeContext(),
              tools: tools,
              tool_choice: "auto",
              stream: true,
              temperature: 0.85,
              max_tokens: 300,
              frequency_penalty: 0.3,
              presence_penalty: 0.2,
            });

            // --- Shared state for streaming ---
            let sentenceBuffer = "";
            let fullResponse = "";
            let ttsStarted = false;
            let ttsFirstChunkLogged = false;
            let ttsStartedAt = 0;
            let firstTokenLogged = false;

            // --- Inline expression tag parsing (Phase 1 buffering) ---
            let tagParsed = false;
            let tagBuffer = "";
            let parsedEmotion = "neutral"; // will be set from [EMO:...] tag
            let streamSentenceIndex = 0; // for inter-sentence pacing
            let firstCharsLogged = false; // debug: log first chars of LLM response

            // --- Tool call accumulation ---
            let hasToolCalls = false;
            const toolCallAccum: Record<number, { id: string; name: string; arguments: string }> = {};

            const speakSentence = async (text: string) => {
              if (interruptRequested || thisResponseId !== currentResponseId) return; // Barge-in or stale response
              if (!ttsStartedAt) ttsStartedAt = Date.now();

              // Add emotional pacing delay between sentences (not before first)
              if (streamSentenceIndex > 0) {
                const delay = EMOTION_SENTENCE_DELAY[parsedEmotion] || 0;
                if (delay > 0) {
                  await new Promise(resolve => setTimeout(resolve, delay));
                }
              }
              if (interruptRequested || thisResponseId !== currentResponseId) return; // Check again after pacing delay
              streamSentenceIndex++;

              await new Promise<void>((resolve) => {
                console.log(`[TTS] Creating Azure TTS instance (${currentVoiceConfig.voiceName}, emotion: ${parsedEmotion})`);
                const tts = new AzureTTSStreamer({ ...currentVoiceConfig, emotion: parsedEmotion });
                tts.on("audio_chunk", (chunk: Buffer) => {
                  if (interruptRequested || thisResponseId !== currentResponseId) {
                    return; // Don't send this chunk — interrupted or stale
                  }
                  if (!ttsFirstChunkLogged) {
                    ttsFirstChunkLogged = true;
                    console.log(`[Latency] TTS first audio: ${Date.now() - ttsStartedAt}ms`);
                    console.log(`[Latency] E2E (EOU → first audio): ${Date.now() - eouReceivedAt}ms`);
                  }
                  ws.send(chunk);
                });
                tts.on("tts_complete", () => resolve());
                tts.on("error", (err: Error) => {
                  console.error(`[TTS] ❌ Stream chunk failed: "${text}"`, err);
                  resolve();
                });
                tts.synthesize(text);
              });
            };

            interruptRequested = false; // Safe to reset — old TTS killed by generation ID

            for await (const chunk of mainStream) {
              const delta = chunk.choices[0]?.delta;

              // --- Tool call path: accumulate fragments ---
              if (delta?.tool_calls) {
                hasToolCalls = true;
                for (const tc of delta.tool_calls) {
                  const idx = tc.index;
                  if (!toolCallAccum[idx]) {
                    toolCallAccum[idx] = { id: "", name: "", arguments: "" };
                  }
                  if (tc.id) toolCallAccum[idx].id = tc.id;
                  if (tc.function?.name) toolCallAccum[idx].name = tc.function.name;
                  if (tc.function?.arguments) toolCallAccum[idx].arguments += tc.function.arguments;
                }
                continue;
              }

              // --- Content path: stream to TTS ---
              const content = delta?.content || "";
              if (!content) continue;

              if (!firstTokenLogged) {
                firstTokenLogged = true;
                console.log(`[Latency] LLM first token: ${Date.now() - llmStartAt}ms`);
              }

              // Lazily initialize TTS pipeline on first content delta
              if (!ttsStarted) {
                ttsStarted = true;
                if (silenceTimer) clearTimeout(silenceTimer);
                setState("speaking");
                ws.send(JSON.stringify({ type: "state_speaking" }));
                ws.send(JSON.stringify({ type: "tts_chunk_starts" }));
                await new Promise(resolve => setImmediate(resolve));
              }

              sentenceBuffer += content;
              fullResponse += content;

              // --- Phase 1: Buffer initial tokens to parse [EMO:...] tag ---
              if (!tagParsed) {
                tagBuffer += content;
                if (!firstCharsLogged && tagBuffer.length >= 30) {
                  firstCharsLogged = true;
                  console.log(`[ExprTag] First 60 chars of LLM response: "${tagBuffer.slice(0, 60)}"`);
                }
                const closeBracket = tagBuffer.indexOf("]");
                if (closeBracket !== -1) {
                  // Found the closing bracket — parse the tag
                  tagParsed = true;
                  const rawTag = tagBuffer.slice(0, closeBracket + 1);
                  const remainder = tagBuffer.slice(closeBracket + 1);
                  const parsed = parseExpressionTag(rawTag);
                  if (parsed) {
                    parsedEmotion = parsed.emotion;
                    sendExpressionFromTag(parsed, "stream tag");
                    tagSuccessCount++;
                    console.log(`[ExprTag] Parsed from stream: ${rawTag}`);
                  } else {
                    tagFallbackCount++;
                    console.log(`[ExprTag] Failed to parse from stream: "${rawTag}", defaulting neutral`);
                    sendExpressionFromTag({ emotion: "neutral" }, "stream fallback");
                  }
                  // Strip the tag from sentenceBuffer (it was already appended)
                  sentenceBuffer = sentenceBuffer.replace(rawTag, "").trimStart();
                } else if (tagBuffer.length > 50) {
                  // Safety: no tag found after 50 chars — give up and treat as normal text
                  tagParsed = true;
                  tagFallbackCount++;
                  console.log(`[ExprTag] No tag found after ${tagBuffer.length} chars, defaulting neutral`);
                  sendExpressionFromTag({ emotion: "neutral" }, "stream no-tag fallback");
                } else {
                  continue; // Still buffering tag — don't process sentences yet
                }
              }

              // Flush complete sentences to TTS immediately
              const match = sentenceBuffer.match(/^(.*?[.!?…]+\s+(?=[A-Z"]))/s);
              if (match) {
                const sentence = stripEmotionTags(match[1].trim());
                sentenceBuffer = sentenceBuffer.slice(match[0].length);
                if (sentence.length > 0) {
                  console.log(`[TTS] Streaming sentence: "${sentence}"`);
                  await speakSentence(sentence);
                }
              }
            }

            // --- After stream ends: handle tool calls or finalize content ---
            if (hasToolCalls) {
              // Process accumulated tool calls
              const toolCallsArray = Object.values(toolCallAccum);
              chatHistory.push({
                role: "assistant",
                content: null,
                tool_calls: toolCallsArray.map(tc => ({
                  id: tc.id,
                  type: "function" as const,
                  function: { name: tc.name, arguments: tc.arguments },
                })),
              });

              for (const tc of toolCallsArray) {
                if (tc.name === "update_viewing_context") {
                  try {
                    const args = JSON.parse(tc.arguments);
                    viewingContext = args.context;
                    console.log(`[Context] Updated viewing context to: "${viewingContext}"`);
                    const systemMsg = chatHistory[0] as OpenAI.Chat.ChatCompletionSystemMessageParam;
                    if (systemMsg) {
                      let sysContent = systemMsg.content as string;
                      const contextMarker = "\n\n[CURRENT CONTEXT]:";
                      if (sysContent.includes(contextMarker)) {
                        sysContent = sysContent.split(contextMarker)[0];
                      }
                      systemMsg.content = sysContent + `${contextMarker} ${viewingContext}`;
                    }
                    chatHistory.push({
                      role: "tool",
                      tool_call_id: tc.id,
                      content: `Context updated to: ${viewingContext}`,
                    });
                  } catch (parseErr) {
                    console.error("[Tool] Failed to parse tool args:", parseErr);
                  }
                }
              }

              // Follow-up streaming call after tool processing (tools omitted to prevent chaining)
              if (silenceTimer) clearTimeout(silenceTimer);
              setState("speaking");
              ws.send(JSON.stringify({ type: "state_speaking" }));
              ws.send(JSON.stringify({ type: "tts_chunk_starts" }));
              await new Promise(resolve => setImmediate(resolve));

              try {
                const followUpStream = await openai.chat.completions.create({
                  model: OPENAI_MODEL,
                  messages: getMessagesWithTimeContext(),
                  stream: true,
                  temperature: 0.85,
                  max_tokens: 300,
                  frequency_penalty: 0.3,
                  presence_penalty: 0.2,
                });

                // Reset tag parsing for the follow-up stream (new LLM call = new tag)
                let followUpTagParsed = false;
                let followUpTagBuffer = "";
                let followUpFirstCharsLogged = false;
                // Reset sentence index for follow-up pacing
                streamSentenceIndex = 0;

                for await (const chunk of followUpStream) {
                  const content = chunk.choices[0]?.delta?.content || "";
                  if (!content) continue;
                  if (!firstTokenLogged) {
                    firstTokenLogged = true;
                    console.log(`[Latency] LLM first token (tool follow-up): ${Date.now() - llmStartAt}ms`);
                  }
                  sentenceBuffer += content;
                  fullResponse += content;

                  // --- Phase 1: Buffer initial tokens to parse [EMO:...] tag ---
                  if (!followUpTagParsed) {
                    followUpTagBuffer += content;
                    if (!followUpFirstCharsLogged && followUpTagBuffer.length >= 30) {
                      followUpFirstCharsLogged = true;
                      console.log(`[ExprTag] First 60 chars of follow-up LLM response: "${followUpTagBuffer.slice(0, 60)}"`);
                    }
                    const closeBracket = followUpTagBuffer.indexOf("]");
                    if (closeBracket !== -1) {
                      followUpTagParsed = true;
                      const rawTag = followUpTagBuffer.slice(0, closeBracket + 1);
                      const parsed = parseExpressionTag(rawTag);
                      if (parsed) {
                        parsedEmotion = parsed.emotion;
                        sendExpressionFromTag(parsed, "tool follow-up tag");
                        tagSuccessCount++;
                        console.log(`[ExprTag] Parsed from tool follow-up: ${rawTag}`);
                      } else {
                        tagFallbackCount++;
                        sendExpressionFromTag({ emotion: "neutral" }, "tool follow-up fallback");
                      }
                      sentenceBuffer = sentenceBuffer.replace(rawTag, "").trimStart();
                    } else if (followUpTagBuffer.length > 50) {
                      followUpTagParsed = true;
                      tagFallbackCount++;
                      sendExpressionFromTag({ emotion: "neutral" }, "tool follow-up no-tag fallback");
                    } else {
                      continue;
                    }
                  }

                  const match = sentenceBuffer.match(/^(.*?[.!?…]+\s+(?=[A-Z"]))/s);
                  if (match) {
                    const sentence = stripEmotionTags(match[1].trim());
                    sentenceBuffer = sentenceBuffer.slice(match[0].length);
                    if (sentence.length > 0) {
                      console.log(`[TTS] Streaming sentence: "${sentence}"`);
                      await speakSentence(sentence);
                    }
                  }
                }
              } catch (followErr) {
                console.error("[Pipeline] Tool follow-up streaming error:", (followErr as Error).message);
              }
            }

            // Flush remaining sentence buffer
            if (sentenceBuffer.trim().length > 0) {
              // Initialize TTS pipeline if nothing was spoken yet (very short response)
              if (!ttsStarted) {
                ttsStarted = true;
                if (silenceTimer) clearTimeout(silenceTimer);
                setState("speaking");
                ws.send(JSON.stringify({ type: "state_speaking" }));
                ws.send(JSON.stringify({ type: "tts_chunk_starts" }));
                await new Promise(resolve => setImmediate(resolve));
              }
              const cleanFinal = stripEmotionTags(sentenceBuffer.trim());
              if (cleanFinal.length > 0) {
                await speakSentence(cleanFinal);
              }
            }

            const llmDoneAt = Date.now();
            console.log(`[Latency] LLM total: ${llmDoneAt - llmStartAt}ms (${fullResponse.length} chars)`);
            llmResponse = stripEmotionTags(stripExpressionTag(fullResponse));

            // If tag wasn't parsed from stream (very short response), parse from full text now
            if (!tagParsed && llmResponse.trim().length > 0) {
              const fallbackParsed = parseExpressionTag(fullResponse);
              if (fallbackParsed) {
                parsedEmotion = fallbackParsed.emotion;
                sendExpressionFromTag(fallbackParsed, "full response fallback");
                tagSuccessCount++;
              } else {
                sendExpressionFromTag({ emotion: "neutral" }, "full response no-tag fallback");
                tagFallbackCount++;
              }
            }

            if (llmResponse.trim().length > 0) {
              chatHistory.push({ role: "assistant", content: llmResponse });
              advanceTimePhase(llmResponse);
            }

            // Vision response length safety net
            if (visionActive && llmResponse.length > 150) {
              const userAskedQuestion = /\?$|\bwhat\b|\bwhy\b|\bhow\b|\bwho\b|\bwhere\b|\bwhen\b|\bdo you\b|\bcan you\b|\btell me\b/i.test(userMessage);
              if (!userAskedQuestion) {
                console.log(`[Vision] Warning: Long response during co-watching: ${llmResponse.length} chars`);
              }
            }

            console.log(`[AI RESPONSE]: "${llmResponse}"`);
            lastKiraSpokeTimestamp = Date.now();
            if (visionActive) rescheduleVisionReaction();
            ws.send(JSON.stringify({ type: "transcript", role: "ai", text: llmResponse }));

            // Latency summary
            const ttsTotal = ttsStartedAt ? Date.now() - ttsStartedAt : 0;
            const e2eTotal = Date.now() - eouReceivedAt;
            console.log(`[Latency] TTS total: ${ttsTotal}ms`);
            console.log(`[Latency Summary] LLM: ${llmDoneAt - llmStartAt}ms | TTS: ${ttsTotal}ms | E2E: ${e2eTotal}ms`);

          } catch (err) {
            console.error("[Pipeline] ❌ OpenAI Error:", (err as Error).message);
          } finally {
            // Always return to listening state and clean up
            try {
              ws.send(JSON.stringify({ type: "tts_chunk_ends" }));
            } catch (_) { /* ws may be closed */ }
            currentTurnTranscript = "";
            currentInterimTranscript = "";
            transcriptClearedAt = Date.now();
            setState("listening");
            try {
              ws.send(JSON.stringify({ type: "state_listening" }));
            } catch (_) { /* ws may be closed */ }
            console.log("[STATE] Back to listening, transcripts cleared.");
            resetSilenceTimer();
          }
        } else if (controlMessage.type === "interrupt") {
          // Client-initiated interrupt (e.g. user clicks stop button)
          // Server-side barge-in is handled in the transcript handler instead
          console.log("[WS] Client interrupt received");
          if (state === "speaking") {
            interruptRequested = true;
            currentResponseId++; // Invalidate any in-flight TTS callbacks
            setState("listening");
            ws.send(JSON.stringify({ type: "state_listening" }));
          }
        } else if (controlMessage.type === "image") {
          // Handle incoming image snapshot
          // Support both single 'image' (legacy/fallback) and 'images' array
          if (controlMessage.images && Array.isArray(controlMessage.images)) {
             // Validate & cap incoming images
             const validImages = controlMessage.images
               .filter((img: unknown) => typeof img === "string" && img.length < 2_000_000)
               .slice(0, 5);
             if (validImages.length === 0) return;
             console.log(`[Vision] Received ${validImages.length} images (${controlMessage.images.length} sent). Updating buffer.`);
             latestImages = validImages;
             lastImageTimestamp = Date.now();
             if (!visionActive) {
               visionActive = true;
               console.log("[Vision] Screen share activated. Starting reaction timer.");
               startVisionReactionTimer();
             }
             lastVisionTimestamp = Date.now();
          } else if (controlMessage.image && typeof controlMessage.image === "string" && controlMessage.image.length < 2_000_000) {
            console.log("[Vision] Received single image snapshot. Updating buffer.");
            latestImages = [controlMessage.image];
            lastImageTimestamp = Date.now();
            if (!visionActive) {
              visionActive = true;
              console.log("[Vision] Screen share activated. Starting reaction timer.");
              startVisionReactionTimer();
            }
            lastVisionTimestamp = Date.now();
          }
        } else if (controlMessage.type === "scene_update" && controlMessage.images && Array.isArray(controlMessage.images)) {
          // Validate & cap scene update images
          const validSceneImages = controlMessage.images
            .filter((img: unknown) => typeof img === "string" && img.length < 2_000_000)
            .slice(0, 5);
          // Scene updates also confirm vision is active
          if (!visionActive) {
            visionActive = true;
            console.log("[Vision] Screen share activated via scene_update. Starting reaction timer.");
            startVisionReactionTimer();
          }
          // Also update latestImages so the buffer stays fresh during silent watching
          if (validSceneImages.length > 0) {
            latestImages = validSceneImages;
            lastImageTimestamp = Date.now();
          }
          lastVisionTimestamp = Date.now();

          // --- WATCH-TOGETHER: Occasional scene reactions ---
          const now = Date.now();
          const SCENE_REACTION_COOLDOWN = 45000; // Max once per 45 seconds
          const SCENE_REACTION_CHANCE = 0.3;      // 30% chance to react

          if (
            viewingContext &&
            state === "listening" &&
            timeWarningPhase !== 'done' && timeWarningPhase !== 'final_goodbye' &&
            now - lastSceneReactionTime > SCENE_REACTION_COOLDOWN &&
            Math.random() < SCENE_REACTION_CHANCE
          ) {
            lastSceneReactionTime = now;
            console.log(`[Scene] Evaluating scene reaction (watching: ${viewingContext})`);

            const imageContent: OpenAI.Chat.ChatCompletionContentPart[] = validSceneImages.map((img: string) => ({
              type: "image_url" as const,
              image_url: { url: img.startsWith("data:") ? img : `data:image/jpeg;base64,${img}`, detail: "low" as const },
            }));
            imageContent.push({
              type: "text" as const,
              text: "[Screen changed — react if something interesting happened, or say nothing]",
            });

            const sceneMessages: OpenAI.Chat.ChatCompletionMessageParam[] = [
              {
                role: "system",
                content: `${KIRA_SYSTEM_PROMPT}\n\nYou're watching ${viewingContext} together with the user. You just noticed something change on screen. Give a brief, natural reaction — like a friend sitting next to someone watching. This should be SHORT: a gasp, a laugh, a quick comment, 1 sentence MAX. Examples of good reactions: "Oh no...", "Wait, is that—", "Ha! I love this part.", "Whoa.", "Okay that was intense." Don't narrate or describe what you see. Just react emotionally. If the moment isn't noteworthy, respond with exactly "[SKIP]" and nothing else.`,
              },
              ...chatHistory.filter(m => m.role !== "system").slice(-4),
              { role: "system", content: EXPRESSION_TAG_REMINDER },
              { role: "user", content: imageContent },
            ];

            // Fire-and-forget — don't block the message loop
            (async () => {
              // Bump generation ID so any in-flight TTS from a previous response is invalidated
              currentResponseId++;
              const thisResponseId = currentResponseId;

              // Lock state BEFORE async LLM call to prevent other proactive systems
              // (silence timer, vision reaction) from also starting a turn
              setState("thinking");
              try {
                const reaction = await openai.chat.completions.create({
                  model: OPENAI_MODEL,
                  messages: sceneMessages,
                  max_tokens: 60,
                  temperature: 1.0,
                });

                let reactionText = reaction.choices[0]?.message?.content?.trim() || "";

                // Only speak if there's real content and we're still in a valid state
                if (
                  !reactionText ||
                  reactionText.length < 2 ||
                  reactionText.includes("[SKIP]") ||
                  reactionText === '""' ||
                  reactionText === "''" ||
                  clientDisconnected ||
                  timeWarningPhase as string === 'done' || timeWarningPhase as string === 'final_goodbye'
                ) {
                  console.log(`[Scene] No reaction (text: "${reactionText}", state: ${state})`);
                  setState("listening");
                  ws.send(JSON.stringify({ type: "state_listening" }));
                  return;
                }

                console.log(`[Scene] Kira reacts: "${reactionText}"`);

                // Parse expression tag and strip before TTS
                const sceneTagResult = handleNonStreamingTag(reactionText, "scene reaction");
                reactionText = stripEmotionTags(sceneTagResult.text);
                const sceneEmotion = sceneTagResult.emotion;

                chatHistory.push({ role: "assistant", content: reactionText });
                lastKiraSpokeTimestamp = Date.now();
                // Don't reschedule vision timer from scene reactions — already handled by scheduleNextReaction()
                ws.send(JSON.stringify({ type: "transcript", role: "ai", text: reactionText }));

                // TTS pipeline for scene reaction
                setState("speaking");
                ws.send(JSON.stringify({ type: "state_speaking" }));
                ws.send(JSON.stringify({ type: "tts_chunk_starts" }));
                await new Promise(resolve => setImmediate(resolve));

                const sentences = reactionText.split(/(?<=[.!?…])\s+(?=[A-Z"])/);
                let sceneSentIdx = 0;
                interruptRequested = false; // Safe to reset — old TTS killed by generation ID
                for (const sentence of sentences) {
                  const trimmed = sentence.trim();
                  if (trimmed.length === 0) continue;
                  if (interruptRequested || thisResponseId !== currentResponseId) break;
                  if (sceneSentIdx > 0) {
                    const delay = EMOTION_SENTENCE_DELAY[sceneEmotion] || 0;
                    if (delay > 0) await new Promise(resolve => setTimeout(resolve, delay));
                  }
                  sceneSentIdx++;
                  await new Promise<void>((resolve) => {
                    const tts = new AzureTTSStreamer({ ...currentVoiceConfig, emotion: sceneEmotion });
                    tts.on("audio_chunk", (chunk: Buffer) => {
                      if (interruptRequested || thisResponseId !== currentResponseId) return;
                      if (!clientDisconnected && ws.readyState === ws.OPEN) ws.send(chunk);
                    });
                    tts.on("tts_complete", () => resolve());
                    tts.on("error", (err: Error) => {
                      console.error(`[Scene TTS] ❌ Chunk failed: "${trimmed}"`, err);
                      resolve();
                    });
                    tts.synthesize(trimmed);
                  });
                }

                ws.send(JSON.stringify({ type: "tts_chunk_ends" }));
                setState("listening");
                ws.send(JSON.stringify({ type: "state_listening" }));
                resetSilenceTimer();
              } catch (err) {
                console.error("[Scene] Reaction error:", (err as Error).message);
                setState("listening");
                try { ws.send(JSON.stringify({ type: "state_listening" })); } catch (_) {}
              }
            })();
          }
        } else if (controlMessage.type === "voice_change") {
          const newVoice = controlMessage.voice as "anime" | "natural";
          currentVoiceConfig = VOICE_CONFIGS[newVoice] || VOICE_CONFIGS.natural;
          console.log(`[Voice] Switched to: ${currentVoiceConfig.voiceName} (style: ${currentVoiceConfig.style || "default"})`);
        } else if (controlMessage.type === "vision_stop") {
          stopVision();
        } else if (controlMessage.type === "pong") {
          // Client responded to heartbeat ping — connection is alive
          // Clear the timeout so we don't close the connection
          if (pongTimeoutTimer) {
            clearTimeout(pongTimeoutTimer);
            pongTimeoutTimer = null;
          }
        } else if (controlMessage.type === "text_message") {
          if (timeWarningPhase === 'done') return; // Don't process new messages after goodbye

          // User sent text — cancel proactive goodbye timeout
          if (goodbyeTimeout) { clearTimeout(goodbyeTimeout); goodbyeTimeout = null; }

          // --- TEXT CHAT: Skip STT and TTS, go directly to LLM ---
          if (state !== "listening") return;
          if (silenceTimer) clearTimeout(silenceTimer);

          const userMessage = typeof controlMessage.text === "string" ? controlMessage.text.trim() : "";
          if (!userMessage || userMessage.length === 0) return;
          if (userMessage.length > 2000) return; // Prevent abuse

          // LLM rate limit check
          llmCallCount++;
          if (llmCallCount > LLM_MAX_CALLS_PER_MINUTE) {
            console.warn(`[RateLimit] LLM call rate exceeded (${llmCallCount}/${LLM_MAX_CALLS_PER_MINUTE}/min). Dropping text_message.`);
            return;
          }

          setState("thinking");
          ws.send(JSON.stringify({ type: "state_thinking" }));

          chatHistory.push({ role: "user", content: userMessage });

          // --- CONTEXT MANAGEMENT (non-blocking — same as voice EOU path) ---
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
            chatHistory.splice(txtFirstMsgIdx, MESSAGES_TO_SUMMARIZE);
            console.log(`[Context] Text chat: truncated ${MESSAGES_TO_SUMMARIZE} oldest messages. Summary deferred.`);

            // Fire-and-forget background summary
            (async () => {
              try {
                const txtMessagesText = txtToCompress
                  .map(m => `${m.role}: ${typeof m.content === "string" ? m.content : "[media]"}`)
                  .join("\n");
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
              } catch (err) {
                console.error("[Memory:L1] Text chat background summary failed:", (err as Error).message);
              }
            })();
          }

          try {
            const txtCompletion = await openai.chat.completions.create({
              model: OPENAI_MODEL,
              messages: getMessagesWithTimeContext(),
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
                messages: getMessagesWithTimeContext(),
                temperature: 0.85,
                max_tokens: 300,
              });
              txtLlmResponse = txtFollowUp.choices[0]?.message?.content || "";
            } else {
              txtLlmResponse = txtInitialMessage?.content || "";
            }

            // Parse expression tag and strip before sending
            const txtTagResult = handleNonStreamingTag(txtLlmResponse, "text chat");
            txtLlmResponse = stripEmotionTags(txtTagResult.text);
            const txtEmotion = txtTagResult.emotion;

            chatHistory.push({ role: "assistant", content: txtLlmResponse });
            advanceTimePhase(txtLlmResponse);

            ws.send(JSON.stringify({
              type: "text_response",
              text: txtLlmResponse,
            }));
          } catch (err) {
            console.error("[TextChat] Error:", (err as Error).message);
            ws.send(JSON.stringify({ type: "error", message: "Failed to get response" }));
          } finally {
            setState("listening");
            ws.send(JSON.stringify({ type: "state_listening" }));
            turnCount++;
            silenceInitiatedLast = false; // User spoke, allow future silence initiation
            resetSilenceTimer();
          }
        }
      } else if (message instanceof Buffer) {
        if (!isAcceptingAudio) return; // Don't forward audio after goodbye or before pipeline ready
        if ((state === "listening" || state === "speaking") && sttStreamer) {
          sttStreamer.write(message); // Forward audio during listening (normal) and speaking (for barge-in detection)
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

    // Decrement per-IP connection count
    const ipCount = connectionsPerIp.get(clientIp) || 1;
    if (ipCount <= 1) connectionsPerIp.delete(clientIp);
    else connectionsPerIp.set(clientIp, ipCount - 1);

    clearInterval(keepAliveInterval);
    clearInterval(messageCountResetInterval);
    clearInterval(llmRateLimitInterval);
    if (pongTimeoutTimer) clearTimeout(pongTimeoutTimer);
    if (usageCheckInterval) clearInterval(usageCheckInterval);
    if (timeCheckInterval) clearInterval(timeCheckInterval);
    if (silenceTimer) clearTimeout(silenceTimer);
    if (goodbyeTimeout) clearTimeout(goodbyeTimeout);
    if (visionReactionTimer) { clearTimeout(visionReactionTimer); visionReactionTimer = null; }
    if (comfortTimer) { clearTimeout(comfortTimer); comfortTimer = null; }
    isFirstVisionReaction = true;
    if (sttStreamer) sttStreamer.destroy();

    // --- USAGE: Flush remaining seconds on disconnect ---
    if (isGuest && userId) {
      if (wasBlockedImmediately) {
        console.log(`[USAGE] Skipping flush — connection was blocked on connect`);
      } else if (sessionStartTime) {
        const finalElapsed = Math.floor((Date.now() - sessionStartTime) / 1000);
        const finalTotal = guestUsageBase + finalElapsed;

        // saveGuestUsage has the "never decrease" guard built in
        await saveGuestUsage(userId, finalTotal);
        console.log(`[USAGE] Flushed guest ${userId}: ${finalTotal}s`);
      }
    } else if (!isGuest && userId && sessionStartTime) {
      if (wasBlockedImmediately) {
        console.log(`[USAGE] Skipping flush — connection was blocked on connect`);
      } else if (isProUser) {
        // Pro users: flush to Prisma MonthlyUsage
        const finalElapsed = Math.floor((Date.now() - sessionStartTime) / 1000);
        const finalTotal = proUsageBase + finalElapsed;
        await saveProUsage(userId, finalTotal);
        console.log(`[USAGE] Flushed Pro ${userId}: ${finalTotal}s`);
      } else {
        // Free signed-in users: flush remainder to Prisma
        const finalElapsed = Math.floor((Date.now() - sessionStartTime) / 1000);
        const alreadyCounted = Math.floor(finalElapsed / 30) * 30;
        const remainder = finalElapsed - alreadyCounted;
        if (remainder > 0) {
          try {
            await prisma.user.update({
              where: { clerkId: userId },
              data: {
                dailyUsageSeconds: { increment: remainder },
                lastUsageDate: new Date(),
              },
            });
          } catch (err) {
            console.error("[Usage] Final flush failed:", (err as Error).message);
          }
        }
      }
    }

    // --- GUEST MEMORY BUFFER (save for potential account creation) ---
    if (isGuest && userId) {
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
          bufferGuestConversation(userId, userMsgs, conversationSummary);
        }
      } catch (err) {
        console.error(
          "[Memory] Guest buffer failed:",
          (err as Error).message
        );
      }
    }

    // --- MEMORY EXTRACTION (ALL users — signed-in AND guests) ---
    if (userId) {
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
          // 1. Save conversation to DB (signed-in users only — guests don't have a User row)
          if (!isGuest) {
            try {
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
            } catch (convErr) {
              console.error(
                "[Memory] Conversation save failed:",
                (convErr as Error).message
              );
            }
          }

          // 2. Extract and save memories (runs for BOTH guests and signed-in users)
          // Guests use their guest_<id> as userId in MemoryFact.
          // createdAt timestamp on MemoryFact enables future 30-day cleanup for guests.
          // When a guest signs up, their facts can be migrated by updating userId.
          await extractAndSaveMemories(
            openai,
            prisma,
            userId,
            userMsgs,
            conversationSummary
          );
          console.log(`[Memory] Extraction complete for ${isGuest ? 'guest' : 'user'} ${userId}`);
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
    clearInterval(llmRateLimitInterval);
    if (pongTimeoutTimer) clearTimeout(pongTimeoutTimer);
    if (usageCheckInterval) clearInterval(usageCheckInterval);
    if (timeCheckInterval) clearInterval(timeCheckInterval);
    if (silenceTimer) clearTimeout(silenceTimer);
    if (goodbyeTimeout) clearTimeout(goodbyeTimeout);
    if (sttStreamer) sttStreamer.destroy();
  });
});

// --- GLOBAL ERROR HANDLERS ---
// Prevent unhandled promise rejections from crashing the server and killing all WebSocket connections
process.on('unhandledRejection', (reason, promise) => {
  console.error('[FATAL] Unhandled Promise Rejection:', reason);
  console.error('Promise:', promise);
  // Don't crash - log and continue
});

process.on('uncaughtException', (error) => {
  console.error('[FATAL] Uncaught Exception:', error);
  // For uncaught exceptions, we should exit gracefully after logging
  // But give existing connections time to finish
  setTimeout(() => {
    console.error('[FATAL] Exiting due to uncaught exception');
    process.exit(1);
  }, 5000);
});

// --- START THE SERVER ---
server.listen(PORT, () => {
  console.log(`🚀 Voice pipeline server listening on :${PORT}`);
});
