import { WebSocketServer } from "ws";
import type { IncomingMessage } from "http";
import { createServer } from "http";
import { URL } from "url";
import { PrismaClient } from "@prisma/client";
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

// --- SERVER-SIDE EMOTION DETECTION ---
const EMOTION_TAG_STRIP = /\s*\[(neutral|happy|excited|love|blush|sad|angry|playful|thinking|speechless|eyeroll|sleepy)\]\s*$/g;

/** Strip any accidental LLM emotion tags from text before TTS. */
function stripEmotionTags(text: string): string {
  return text.replace(EMOTION_TAG_STRIP, "").trim();
}

/** Detect emotion from response text via keyword matching. */
function detectEmotion(text: string): string {
  const lower = text.toLowerCase();

  // Order matters — check more specific patterns first

  // Blush: compliment responses, embarrassment, flattery
  if (/\b(blush|flatter|you're (too |so )?(sweet|kind|nice)|stop it|making me)\b/.test(lower) ||
      /\b(aww+|oh stop)\b/.test(lower)) {
    return "blush";
  }

  // Excited: enthusiasm, amazement, strong interest
  if (/\b(so (cool|awesome|amazing|exciting|fun)|can't wait|love (that|it|this)|no way|that's (amazing|awesome|incredible|fantastic))\b/.test(lower) ||
      /!.*!/.test(text) || // Multiple exclamation marks
      /\b(oh my (god|gosh)|whoa|wow)\b/.test(lower)) {
    return "excited";
  }

  // Love: adoring, deep affection
  if (/\b(love love|adore|heart|so (beautiful|precious|adorable))\b/.test(lower) ||
      /\b(that's .{0,20}beautiful|warms my heart)\b/.test(lower)) {
    return "love";
  }

  // Sad: empathy, sadness, emotional pain
  if (/\b(so sad|that's (tough|rough|hard)|i'm sorry|breaks my heart|that sucks|feel for you)\b/.test(lower) ||
      (/\b(aw+|oh no)\b/.test(lower) && /\b(sorry|sad|tough|hard)\b/.test(lower))) {
    return "sad";
  }

  // Playful: teasing, joking, banter
  if (/\b(haha|hehe|lol|just (kidding|messing)|tease|cheeky|bet you|oh come on)\b/.test(lower) ||
      /\b(pfft|you wish)\b/.test(lower)) {
    return "playful";
  }

  // Thinking: pondering, considering, philosophical
  if (/\b(hmm+|let me think|that's a (good|great|tough|interesting) question|i wonder|tricky)\b/.test(lower) ||
      /\b(honestly.{0,20}not sure|hard to say)\b/.test(lower)) {
    return "thinking";
  }

  // Speechless: shock, disbelief, overwhelmed
  if (/\b(speechless|i (just )?can't|no words|that's .{0,10}(wild|insane|unreal|unbelievable))\b/.test(lower)) {
    return "speechless";
  }

  // Eyeroll: sarcasm, exasperation, "really?"
  if (/\b(oh (please|really|great|sure)|ugh|seriously|of course|typical|yeah right)\b/.test(lower)) {
    return "eyeroll";
  }

  // Sleepy: tired, late night, winding down
  if (/\b(sleep|tired|exhausted|yawn|bedtime|rest|winding down|so late)\b/.test(lower)) {
    return "sleepy";
  }

  // Angry: frustration, annoyance
  if (/\b(so (annoying|frustrating|unfair)|that's (wrong|messed up)|can't (believe|stand))\b/.test(lower)) {
    return "angry";
  }

  // Happy: general positive vibes (broad catch — better than neutral)
  if (/\b(great|awesome|nice|sounds (like a plan|fun|good|perfect)|i'd love|totally|absolutely|let's do)\b/.test(lower) ||
      /!\s*$/.test(text.trim())) { // Ends with exclamation
    return "happy";
  }

  return "neutral";
}

const clerkClient = createClerkClient({ secretKey: CLERK_SECRET_KEY });
const prisma = new PrismaClient();
const openai = new OpenAI({ apiKey: OPENAI_API_KEY });

const server = createServer((req, res) => {
  if (req.url === "/health") {
    res.writeHead(200, { "Content-Type": "text/plain" });
    res.end("ok");
    return;
  }

  // --- Guest buffer retrieval endpoint (called by Clerk webhook) ---
  if (req.url?.startsWith("/api/guest-buffer/") && req.method === "DELETE") {
    const authHeader = req.headers.authorization;
    if (authHeader !== `Bearer ${process.env.INTERNAL_API_SECRET}`) {
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
const wss = new WebSocketServer({ server });

  console.log("[Server] Starting...");

wss.on("connection", (ws: any, req: IncomingMessage) => {
  // --- ORIGIN VALIDATION ---
  const origin = req.headers.origin;
  const allowedOrigins = [
    "https://www.xoxokira.com",
    "https://xoxokira.com",
    "http://localhost:3000",
  ];

  if (origin && !allowedOrigins.includes(origin)) {
    console.warn(`[WS] Rejected connection from origin: ${origin}`);
    ws.close(1008, "Origin not allowed");
    return;
  }

  console.log("[WS] New client connecting...");
  const url = new URL(req.url!, `wss://${req.headers.host}`);
  const token = url.searchParams.get("token");
  const guestId = url.searchParams.get("guestId");
  const voicePreference = url.searchParams.get("voice") || "anime";

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
  let timeWarningPhase: 'normal' | 'final_goodbye' | 'done' = 'normal';
  let goodbyeTimeout: NodeJS.Timeout | null = null;
  let isAcceptingAudio = false;
  let lastSceneReactionTime = 0;
  let visionActive = false;
  let lastVisionTimestamp = 0;
  let lastKiraSpokeTimestamp = 0;
  let lastUserSpokeTimestamp = 0;
  let visionReactionTimer: ReturnType<typeof setTimeout> | null = null;
  let isFirstVisionReaction = true;

  // --- Comfort Arc: timed accessory progression ---
  let comfortStage = 0; // 0=default, 1=jacket off, 2=bangs clipped, 3=earbuds
  let comfortTimer: NodeJS.Timeout | null = null;

  const COMFORT_STAGES = [
    { delay: 60000, expression: "remove_jacket", label: "jacket off" },      // 1 min
    { delay: 150000, expression: "clip_bangs", label: "bangs clipped" },     // 2.5 min after jacket (3.5 min total)
    { delay: 240000, expression: "earbuds", label: "earbuds in" },           // 4 min after bangs (7.5 min total)
  ];

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
    if (clientDisconnected) {
      console.log("[Vision Reaction] Skipping — client disconnected.");
      return;
    }
    if (!latestImages || latestImages.length === 0) {
      console.log(`[Vision Reaction] Skipping — no images in buffer. Last image received: ${lastImageTimestamp ? new Date(lastImageTimestamp).toISOString() : "never"}`);
      // Retry sooner — periodic captures should fill the buffer shortly
      state = "listening";
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
    state = "thinking";

    const firstReactionExtra = isFirstVisionReaction
      ? `\nThis is the FIRST moment you're seeing their screen. React with excitement about what you see — acknowledge that you can see it and comment on something specific. Examples:
- "Ooh nice, I love this anime!"
- "Oh wait I can see your screen now, this looks so good"
- "Ooh what are we watching? The art style is gorgeous"
- "Oh this anime! The vibes are immaculate already"
Keep it natural and brief — 1 sentence.`
      : "";

    const reactionImageContent: OpenAI.Chat.ChatCompletionContentPart[] = latestImages.map((img) => ({
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
      { role: "user", content: reactionImageContent },
    ];

    try {
      const reactionResponse = await openai.chat.completions.create({
        model: OPENAI_MODEL,
        messages: reactionMessages,
        max_tokens: 40,
        temperature: 0.95,
      });

      let reaction = reactionResponse.choices[0]?.message?.content?.trim() || "";

      // Check for actual silence tokens FIRST
      if (!reaction || reaction.includes("[SILENT]") || reaction.includes("[SKIP]") || reaction.startsWith("[") || reaction.length < 2) {
        console.log(`[Vision Reaction] LLM explicitly chose silence. Raw: "${reaction}"`);
        console.log("[Vision Reaction] Scheduling retry in 30-45 seconds instead of full cooldown.");
        state = "listening";

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

      // Detect emotion and strip any accidental tags before TTS
      reaction = stripEmotionTags(reaction);
      const emotionVisionReaction = detectEmotion(reaction);
      ws.send(JSON.stringify({ type: "expression", expression: emotionVisionReaction }));
      console.log(`[Expression] ${emotionVisionReaction}`);

      console.log(`[Vision Reaction] Kira says: "${reaction}"`);
      chatHistory.push({ role: "assistant", content: reaction });
      lastKiraSpokeTimestamp = Date.now();
      isFirstVisionReaction = false;
      ws.send(JSON.stringify({ type: "transcript", role: "ai", text: reaction }));

      // TTS pipeline
      state = "speaking";
      ws.send(JSON.stringify({ type: "state_speaking" }));
      ws.send(JSON.stringify({ type: "tts_chunk_starts" }));
      await new Promise(resolve => setImmediate(resolve));

      try {
        const sentences = reaction.split(/(?<=[.!?…])\s+(?=[A-Z"])/);
        for (const sentence of sentences) {
          const trimmed = sentence.trim();
          if (trimmed.length === 0) continue;
          await new Promise<void>((resolve) => {
            const tts = new AzureTTSStreamer(currentVoiceConfig);
            tts.on("audio_chunk", (chunk: Buffer) => {
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
        ws.send(JSON.stringify({ type: "tts_chunk_ends" }));
        state = "listening";
        ws.send(JSON.stringify({ type: "state_listening" }));
      }
    } catch (err) {
      console.error("[Vision Reaction] Error:", (err as Error).message);
      state = "listening";
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

  // --- L1: In-Conversation Memory ---
  let conversationSummary = "";

  // --- SILENCE-INITIATED TURNS ---
  let silenceTimer: NodeJS.Timeout | null = null;
  const SILENCE_THRESHOLD_MS = 25000; // 25 seconds of quiet before Kira might speak
  let turnCount = 0; // Track conversation depth for silence behavior
  let silenceInitiatedLast = false; // Prevents monologue loops — Kira gets ONE unprompted turn

  function resetSilenceTimer() {
    if (silenceTimer) clearTimeout(silenceTimer);

    // Don't initiate during first 2 turns (let the user settle in)
    if (turnCount < 2) return;

    silenceTimer = setTimeout(async () => {
      if (state !== "listening" || clientDisconnected) return;
      if (silenceInitiatedLast) return; // Already spoke unprompted, wait for user

      // --- Vision-aware silence behavior ---
      if (visionActive) {
        console.log("[Silence] Vision active — using dedicated reaction timer instead.");
        return;
      }

      silenceInitiatedLast = true;
      state = "thinking"; // Lock state IMMEDIATELY to prevent race condition
      if (silenceTimer) clearTimeout(silenceTimer); // Clear self

      console.log(`[Silence] User has been quiet. Checking if Kira has something to say.${visionActive ? ' (vision mode)' : ''}`);

      // Inject a one-time nudge (removed after the turn)
      const nudge: OpenAI.Chat.ChatCompletionMessageParam = {
        role: "system",
        content: visionActive
          ? `[You've been watching together quietly. If something interesting is happening on screen right now, give a very brief reaction (1-5 words). If the scene is calm or nothing stands out, respond with exactly "[SILENCE]" and nothing else.]`
          : `[The user has been quiet for a moment. This is a natural pause in conversation. If you have something on your mind — a thought, a follow-up question about something they said earlier, something you've been curious about, a reaction to something from the memory block — now is a natural time to share it. Speak as if you just thought of something. Be genuine. If you truly have nothing to say, respond with exactly "[SILENCE]" and nothing else. Do NOT say "are you still there" or "what are you thinking about" or "is everything okay" — those feel robotic. Only speak if you have something real to say.]`
      };

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

        // Remove the nudge from history regardless of outcome
        const nudgeIdx = chatHistory.indexOf(nudge);
        if (nudgeIdx >= 0) chatHistory.splice(nudgeIdx, 1);

        // If model returned silence marker or empty, don't speak
        if (!responseText || 
            responseText.toLowerCase().includes("silence") || 
            responseText.startsWith("[") ||
            responseText.length < 5) {
          console.log("[Silence] Kira has nothing to say. Staying quiet.");
          return;
        }

        // Detect emotion and strip any accidental tags before TTS
        responseText = stripEmotionTags(responseText);
        const emotionSilence = detectEmotion(responseText);
        ws.send(JSON.stringify({ type: "expression", expression: emotionSilence }));
        console.log(`[Expression] ${emotionSilence}`);

        // She has something to say — run the TTS pipeline
        chatHistory.push({ role: "assistant", content: responseText });
        console.log(`[Silence] Kira initiates: "${responseText}"`);
        lastKiraSpokeTimestamp = Date.now();
        // Don't reschedule vision timer from silence checker — these are separate systems
        ws.send(JSON.stringify({ type: "transcript", role: "ai", text: responseText }));

        state = "speaking";
        ws.send(JSON.stringify({ type: "state_speaking" }));
        ws.send(JSON.stringify({ type: "tts_chunk_starts" }));
        await new Promise(resolve => setImmediate(resolve));

        try {
          const sentences = responseText.split(/(?<=[.!?…])\s+(?=[A-Z"])/);
          for (const sentence of sentences) {
            const trimmed = sentence.trim();
            if (trimmed.length === 0) continue;
            await new Promise<void>((resolve) => {
              console.log(`[TTS] Creating Azure TTS instance (${currentVoiceConfig.voiceName})`);
              const tts = new AzureTTSStreamer(currentVoiceConfig);
              tts.on("audio_chunk", (chunk: Buffer) => ws.send(chunk));
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
          state = "listening";
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

    }, SILENCE_THRESHOLD_MS);
  }

  // --- Reusable LLM → TTS pipeline ---
  async function runKiraTurn() {
    let llmResponse = "";
    if (silenceTimer) clearTimeout(silenceTimer);
    state = "speaking";
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

      // Detect emotion and strip any accidental tags before TTS
      llmResponse = stripEmotionTags(llmResponse);
      const emotionRunKira = detectEmotion(llmResponse);
      ws.send(JSON.stringify({ type: "expression", expression: emotionRunKira }));
      console.log(`[Expression] ${emotionRunKira}`);

      chatHistory.push({ role: "assistant", content: llmResponse });
      advanceTimePhase(llmResponse);

      console.log(`[AI RESPONSE]: "${llmResponse}"`);
      lastKiraSpokeTimestamp = Date.now();
      if (visionActive) rescheduleVisionReaction();
      ws.send(JSON.stringify({ type: "transcript", role: "ai", text: llmResponse }));

      const sentences = llmResponse.split(/(?<=[.!?…])\s+(?=[A-Z"])/);
      for (const sentence of sentences) {
        const trimmed = sentence.trim();
        if (trimmed.length === 0) continue;
        await new Promise<void>((resolve) => {
          console.log(`[TTS] Creating Azure TTS instance (${currentVoiceConfig.voiceName})`);
          const tts = new AzureTTSStreamer(currentVoiceConfig);
          tts.on("audio_chunk", (chunk: Buffer) => ws.send(chunk));
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
      state = "listening";
      ws.send(JSON.stringify({ type: "state_listening" }));
      resetSilenceTimer();
    }
  }

  // --- Time-context injection for graceful paywall ---
  function getTimeContext(): string {
    if (timeWarningPhase === 'final_goodbye') {
      return `\n\n[CRITICAL INSTRUCTION - MUST FOLLOW: This is your LAST response. Time is up. Keep your ENTIRE response to 1 sentence. Say a quick warm goodbye. Example: "Hey, that was really fun - come back and talk to me tomorrow, okay?" Do NOT continue the previous topic in depth. Just say bye.]`;
    }
    return '';
  }

  /** Build messages array with time + vision context injected into system prompt (without mutating chatHistory). */
  function getMessagesWithTimeContext(): OpenAI.Chat.ChatCompletionMessageParam[] {
    const timeCtx = getTimeContext();
    const visionCtx = visionActive ? VISION_CONTEXT_PROMPT : '';
    if (!timeCtx && !visionCtx) return chatHistory;
    // Clone and inject time + vision context into the system prompt
    return chatHistory.map((msg, i) => {
      if (i === 0 && msg.role === 'system' && typeof msg.content === 'string') {
        return { ...msg, content: msg.content + visionCtx + timeCtx };
      }
      return msg;
    });
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
        { role: "system", content: KIRA_SYSTEM_PROMPT + `\n\n[CRITICAL INSTRUCTION - MUST FOLLOW: You must say goodbye RIGHT NOW. Time is up. Keep it to ONE short sentence. Be warm but fast. Reference something from the conversation. Example: "Hey, our time's up for today - but let's pick this up tomorrow, okay?"]` },
        ...chatHistory.filter(m => m.role !== "system").slice(-4),
        { role: "user", content: "[Time is up - say goodbye immediately]" },
      ];

      const response = await openai.chat.completions.create({
        model: OPENAI_MODEL,
        messages: goodbyeMessages,
        max_tokens: 40,
        temperature: 0.9,
      });

      const goodbyeText = response.choices[0]?.message?.content?.trim() || "";
      if (goodbyeText && goodbyeText.length > 2 && ws.readyState === ws.OPEN && !clientDisconnected) {
        // Detect emotion and strip any accidental tags before TTS
        const finalGoodbye = stripEmotionTags(goodbyeText);
        const emotionGoodbye = detectEmotion(finalGoodbye);
        ws.send(JSON.stringify({ type: "expression", expression: emotionGoodbye }));
        console.log(`[Expression] ${emotionGoodbye}`);

        console.log(`[Goodbye] Kira says: "${finalGoodbye}"`);
        chatHistory.push({ role: "assistant", content: finalGoodbye });
        ws.send(JSON.stringify({ type: "transcript", role: "ai", text: finalGoodbye }));

        state = "speaking";
        ws.send(JSON.stringify({ type: "state_speaking" }));
        ws.send(JSON.stringify({ type: "tts_chunk_starts" }));
        await new Promise(resolve => setImmediate(resolve));

        const sentences = finalGoodbye.split(/(?<=[.!?\u2026])\s+(?=[A-Z"])/);
        for (const sentence of sentences) {
          const trimmed = sentence.trim();
          if (trimmed.length === 0) continue;
          await new Promise<void>((resolve) => {
            const tts = new AzureTTSStreamer(currentVoiceConfig);
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
  const SUMMARIZE_THRESHOLD = 14;
  const MESSAGES_TO_SUMMARIZE = 4;

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
              const memoryBlock = await loadUserMemories(prisma, userId);
              if (memoryBlock) {
                chatHistory.push({ role: "system", content: memoryBlock });
                console.log(
                  `[Memory] Loaded ${memoryBlock.length} chars of persistent memory for ${isGuest ? 'guest' : 'user'} ${userId}`
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

                if (isProUser) {
                  // Pro users: monthly usage tracked in Supabase (resets per calendar month)
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
                // Pro users: monthly usage tracked in Supabase
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
              state = "thinking";
              ws.send(JSON.stringify({ type: "state_thinking" }));

              const openerMessages: OpenAI.Chat.ChatCompletionMessageParam[] = [
                ...chatHistory,
                { role: "system", content: openerInstruction },
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
              if (!openerText || openerText.length < 3 || clientDisconnected) return;

              // Detect emotion and strip any accidental tags before TTS
              openerText = stripEmotionTags(openerText);
              const emotionOpener = detectEmotion(openerText);
              ws.send(JSON.stringify({ type: "expression", expression: emotionOpener }));
              console.log(`[Expression] ${emotionOpener}`);

              // Add to chat history (NOT the instruction — just the greeting)
              chatHistory.push({ role: "assistant", content: openerText });
              console.log(`[Opener] Kira says: "${openerText}"`);
              ws.send(JSON.stringify({ type: "transcript", role: "ai", text: openerText }));

              // --- TTS pipeline for opener ---
              state = "speaking";
              ws.send(JSON.stringify({ type: "state_speaking" }));
              ws.send(JSON.stringify({ type: "tts_chunk_starts" }));
              await new Promise(resolve => setImmediate(resolve));

              const sentences = openerText.split(/(?<=[.!?…])\s+(?=[A-Z"])/);
              for (const sentence of sentences) {
                const trimmed = sentence.trim();
                if (trimmed.length === 0) continue;
                await new Promise<void>((resolve) => {
                  const tts = new AzureTTSStreamer(currentVoiceConfig);
                  tts.on("audio_chunk", (chunk: Buffer) => {
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

              ws.send(JSON.stringify({ type: "tts_chunk_ends" }));
              state = "listening";
              ws.send(JSON.stringify({ type: "state_listening" }));
              turnCount++; // Count the opener as a turn
              resetSilenceTimer();

              // Start comfort arc after opener completes
              startComfortProgression(ws);
            } catch (err) {
              console.error("[Opener] Error:", (err as Error).message);
              state = "listening";
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
            return; // Already thinking/speaking
          }

          // CRITICAL: Lock state IMMEDIATELY to prevent audio from leaking into next turn
          state = "thinking";
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
              state = "listening";
              return;
            }

            consecutiveEmptyEOUs++;
            console.log(`[EOU] No transcript available (${consecutiveEmptyEOUs} consecutive empty EOUs), ignoring EOU.`);
            state = "listening"; // Reset state — don't get stuck in "thinking"

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
              messages: getMessagesWithTimeContext(),
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

              // Detect emotion and strip any accidental tags before TTS
              llmResponse = stripEmotionTags(llmResponse);
              const emotionDirect = detectEmotion(llmResponse);
              ws.send(JSON.stringify({ type: "expression", expression: emotionDirect }));
              console.log(`[Expression] ${emotionDirect}`);

              chatHistory.push({ role: "assistant", content: llmResponse });
              advanceTimePhase(llmResponse);

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
              
              if (silenceTimer) clearTimeout(silenceTimer);
              state = "speaking";
              ws.send(JSON.stringify({ type: "state_speaking" }));
              ws.send(JSON.stringify({ type: "tts_chunk_starts" }));

              // Yield one event-loop tick so the WebSocket control frames
              // (state_speaking, tts_chunk_starts) are flushed to the client
              // BEFORE any binary TTS audio frames are sent
              await new Promise(resolve => setImmediate(resolve));

              try {
                // Split on sentence-ending punctuation followed by space+uppercase
                // Preserves ALL text — no silent drops like .match() had
                const sentences = llmResponse.split(/(?<=[.!?…])\s+(?=[A-Z"])/);
                for (const sentence of sentences) {
                  const trimmed = sentence.trim();
                  if (trimmed.length === 0) continue;
                  await new Promise<void>((resolve) => {
                    console.log(`[TTS] Creating Azure TTS instance (${currentVoiceConfig.voiceName})`);
                    const tts = new AzureTTSStreamer(currentVoiceConfig);
                    tts.on("audio_chunk", (chunk: Buffer) => ws.send(chunk));
                    tts.on("tts_complete", () => resolve());
                    tts.on("error", (err: Error) => {
                      console.error(`[TTS] ❌ Tool-call chunk failed: "${trimmed}"`, err);
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
                resetSilenceTimer();
              }
              
              // Skip the streaming path below
              return;
            }

            // Step 2: Streaming LLM call (only reached if tool calls were processed)
            // NOTE: This is an intentional second LLM call. After processing tool calls (e.g.
            // update_viewing_context), we need a fresh completion that incorporates the tool
            // results. Tools are omitted here to prevent infinite chaining. Adds ~1-2s latency
            // on tool-call turns only (which are infrequent).
            if (silenceTimer) clearTimeout(silenceTimer);
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
                messages: getMessagesWithTimeContext(),
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
                  console.log(`[TTS] Creating Azure TTS instance (${currentVoiceConfig.voiceName})`);
                  const tts = new AzureTTSStreamer(currentVoiceConfig);
                  tts.on("audio_chunk", (chunk: Buffer) => ws.send(chunk));
                  tts.on("tts_complete", () => resolve());
                  tts.on("error", (err: Error) => {
                    console.error(`[TTS] ❌ Stream chunk failed: "${text}"`, err);
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

              // Flush remaining text (strip any accidental tags from final chunk)
              if (sentenceBuffer.trim().length > 0) {
                const cleanFinal = stripEmotionTags(sentenceBuffer.trim());
                if (cleanFinal.length > 0) {
                  await speakSentence(cleanFinal);
                }
              }

              llmResponse = fullResponse;
              // Detect emotion from the full streamed response and strip tags
              llmResponse = stripEmotionTags(llmResponse);
              const emotionStreamed = detectEmotion(llmResponse);
              ws.send(JSON.stringify({ type: "expression", expression: emotionStreamed }));
              console.log(`[Expression] ${emotionStreamed}`);

              chatHistory.push({ role: "assistant", content: llmResponse });
              advanceTimePhase(llmResponse);

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
              resetSilenceTimer();
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
             if (!visionActive) {
               visionActive = true;
               console.log("[Vision] Screen share activated. Starting reaction timer.");
               startVisionReactionTimer();
             }
             lastVisionTimestamp = Date.now();
          } else if (controlMessage.image) {
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
          // Scene updates also confirm vision is active
          if (!visionActive) {
            visionActive = true;
            console.log("[Vision] Screen share activated via scene_update. Starting reaction timer.");
            startVisionReactionTimer();
          }
          // Also update latestImages so the buffer stays fresh during silent watching
          if (controlMessage.images.length > 0) {
            latestImages = controlMessage.images;
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

            const imageContent: OpenAI.Chat.ChatCompletionContentPart[] = controlMessage.images.map((img: string) => ({
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
              { role: "user", content: imageContent },
            ];

            // Fire-and-forget — don't block the message loop
            (async () => {
              try {
                const reaction = await openai.chat.completions.create({
                  model: OPENAI_MODEL,
                  messages: sceneMessages,
                  max_tokens: 30,
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
                  state !== "listening" ||
                  clientDisconnected ||
                  timeWarningPhase as string === 'done' || timeWarningPhase as string === 'final_goodbye'
                ) {
                  console.log(`[Scene] No reaction (text: "${reactionText}", state: ${state})`);
                  return;
                }

                console.log(`[Scene] Kira reacts: "${reactionText}"`);

                // Detect emotion and strip any accidental tags before TTS
                reactionText = stripEmotionTags(reactionText);
                const emotionScene = detectEmotion(reactionText);
                ws.send(JSON.stringify({ type: "expression", expression: emotionScene }));
                console.log(`[Expression] ${emotionScene}`);

                chatHistory.push({ role: "assistant", content: reactionText });
                lastKiraSpokeTimestamp = Date.now();
                // Don't reschedule vision timer from scene reactions — already handled by scheduleNextReaction()
                ws.send(JSON.stringify({ type: "transcript", role: "ai", text: reactionText }));

                // TTS pipeline for scene reaction
                state = "speaking";
                ws.send(JSON.stringify({ type: "state_speaking" }));
                ws.send(JSON.stringify({ type: "tts_chunk_starts" }));
                await new Promise(resolve => setImmediate(resolve));

                const sentences = reactionText.split(/(?<=[.!?…])\s+(?=[A-Z"])/);
                for (const sentence of sentences) {
                  const trimmed = sentence.trim();
                  if (trimmed.length === 0) continue;
                  await new Promise<void>((resolve) => {
                    const tts = new AzureTTSStreamer(currentVoiceConfig);
                    tts.on("audio_chunk", (chunk: Buffer) => {
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
                state = "listening";
                ws.send(JSON.stringify({ type: "state_listening" }));
                resetSilenceTimer();
              } catch (err) {
                console.error("[Scene] Reaction error:", (err as Error).message);
                // Ensure state is restored on error
                if (state === "speaking") {
                  state = "listening";
                  try { ws.send(JSON.stringify({ type: "state_listening" })); } catch (_) {}
                }
              }
            })();
          }
        } else if (controlMessage.type === "voice_change") {
          const newVoice = controlMessage.voice as "anime" | "natural";
          currentVoiceConfig = VOICE_CONFIGS[newVoice] || VOICE_CONFIGS.natural;
          console.log(`[Voice] Switched to: ${currentVoiceConfig.voiceName} (style: ${currentVoiceConfig.style || "default"})`);
        } else if (controlMessage.type === "vision_stop") {
          stopVision();
        } else if (controlMessage.type === "text_message") {
          if (timeWarningPhase === 'done') return; // Don't process new messages after goodbye

          // User sent text — cancel proactive goodbye timeout
          if (goodbyeTimeout) { clearTimeout(goodbyeTimeout); goodbyeTimeout = null; }

          // --- TEXT CHAT: Skip STT and TTS, go directly to LLM ---
          if (state !== "listening") return;
          if (silenceTimer) clearTimeout(silenceTimer);

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

            // Detect emotion and strip any accidental tags
            txtLlmResponse = stripEmotionTags(txtLlmResponse);
            const emotionTxt = detectEmotion(txtLlmResponse);
            ws.send(JSON.stringify({ type: "expression", expression: emotionTxt }));
            console.log(`[Expression] ${emotionTxt}`);

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
            state = "listening";
            ws.send(JSON.stringify({ type: "state_listening" }));
            turnCount++;
            silenceInitiatedLast = false; // User spoke, allow future silence initiation
            resetSilenceTimer();
          }
        }
      } else if (message instanceof Buffer) {
        if (!isAcceptingAudio) return; // Don't forward audio after goodbye or before pipeline ready
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
        // Pro users: flush to Supabase
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
    if (usageCheckInterval) clearInterval(usageCheckInterval);
    if (timeCheckInterval) clearInterval(timeCheckInterval);
    if (silenceTimer) clearTimeout(silenceTimer);
    if (goodbyeTimeout) clearTimeout(goodbyeTimeout);
    if (sttStreamer) sttStreamer.destroy();
  });
});

// --- START THE SERVER ---
server.listen(PORT, () => {
  console.log(`🚀 Voice pipeline server listening on :${PORT}`);
});
