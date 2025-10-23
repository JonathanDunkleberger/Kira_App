// FILE: packages/socket-server/socket-server.mts
import "dotenv/config";
import { WebSocketServer, WebSocket } from "ws";
import http from "node:http";
import { PrismaClient } from "@prisma/client";
import { verifyToken } from "@clerk/clerk-sdk-node";
import { createClient } from "@deepgram/sdk";
import OpenAI from "openai";
import * as AzureSpeechSDK from "microsoft-cognitiveservices-speech-sdk";
import fs from "node:fs";
import path from "node:path";
import type { ServerEvent } from "./lib/voice-protocol.js";

// Usage / Paywall limits
// NOTE: Env uses FREE_TRIAL_SECONDS for free daily allowance
const FREE_TRIAL_SECONDS = parseInt(
  process.env.FREE_TRIAL_SECONDS || "900",
  10
); // default 15 minutes if not provided
// Alias to align with planned client/server naming
const PRO_SESSION_SECONDS = parseInt(
  process.env.PRO_SESSION_SECONDS || "7200", // Default to 2 hours
  10
);

interface ActiveSessionInfo {
  userId: string | null; // null until resolved (auth TBD)
  guestId?: string | null;
  conversationId: string;
  startedAt: number; // ms
  // Session (continuous call) seconds for Pro session limit checks
  sessionSeconds: number;
  // Daily accumulated seconds (free users only increment)
  secondsUsedToday: number;
  // Whether user has a Pro subscription (placeholder false until auth integrated)
  isPro: boolean;
  interval?: NodeJS.Timer;
  limitReached?: boolean;
}

const activeSessions = new Map<WebSocket, ActiveSessionInfo>();

function requireEnv(name: string): string {
  const value = process.env[name];
  if (!value) {
    throw new Error(`Missing required environment variable: ${name}`);
  }
  return value;
}

function loadPersona(): string {
  try {
    const candidates = [
      process.env.PERSONA_PATH,
      path.resolve(process.cwd(), "packages", "web", "docs", "messages_rls.md"),
    ].filter(Boolean) as string[];
    for (const p of candidates) {
      try {
        if (fs.existsSync(p)) {
          const content = fs.readFileSync(p, "utf8").trim();
          if (content) {
            console.log("[Persona] Loaded prompt from:", p);
            return content;
          }
        }
      } catch (e) {
        console.warn(
          `[Persona] Failed reading ${p}:`,
          (e as any)?.message || e
        );
      }
    }
  } catch {}
  console.warn("[Persona] Falling back to built-in short prompt.");
  return "You are Kira, an encouraging, upbeat AI companion.";
}
const PERSONALITY_PROMPT = loadPersona();

// --- Required environment variables and defaults ---
const PORT = parseInt(process.env.PORT || "3001", 10);
const CLERK_SECRET_KEY = requireEnv("CLERK_SECRET_KEY");
const DEEPGRAM_API_KEY = requireEnv("DEEPGRAM_API_KEY");
const OPENAI_API_KEY = requireEnv("OPENAI_API_KEY");
const AZURE_SPEECH_KEY = requireEnv("AZURE_SPEECH_KEY");
const AZURE_SPEECH_REGION = requireEnv("AZURE_SPEECH_REGION");
const AZURE_TTS_VOICE = process.env.AZURE_TTS_VOICE || "en-US-AriaNeural";
const AZURE_TTS_RATE = process.env.AZURE_TTS_RATE || "+0%";
const AZURE_TTS_PITCH = process.env.AZURE_TTS_PITCH || "+0%";

// Remove emojis / unsupported glyphs for TTS safety
function cleanTextForTTS(text: string): string {
  const emojiRegex =
    /[\u{1F600}-\u{1F64F}\u{1F300}-\u{1F5FF}\u{1F680}-\u{1F6FF}\u{1F700}-\u{1F77F}\u{1F780}-\u{1F7FF}\u{1F800}-\u{1F8FF}\u{1F900}-\u{1F9FF}\u{1FA00}-\u{1FA6F}\u{1FA70}-\u{1FAFF}\u{2600}-\u{26FF}\u{2700}-\u{27BF}]/gu;
  const cleaned = text
    .replace(emojiRegex, " ") // space preserves cadence
    .replace(/[\p{Cc}\p{Cf}]/gu, "")
    .replace(/\s+/g, " ")
    .trim();
  if (cleaned !== text) {
    console.log("[TTS Clean] Modified sentence before synthesis.", {
      original: text,
      cleaned,
    });
  }
  return cleaned;
}

const DEEPGRAM_DISABLED = /^true$/i.test(
  process.env.DEEPGRAM_DISABLED || "false"
);
const DEEPGRAM_MODE = (process.env.DEEPGRAM_MODE || "explicit").toLowerCase();
const DEEPGRAM_MODEL = process.env.DEEPGRAM_MODEL || "nova-2";
// Deepgram expects 'encoding' to describe the codec (e.g., 'opus'), not the container ('webm').
// For browser MediaRecorder (audio/webm;codecs=opus), use encoding='opus'.
// Note: Deepgram can infer sample rate and channels from the container, but we include
// an explicit sample_rate for robustness with some browsers and environments.
const DEEPGRAM_ENCODING = process.env.DEEPGRAM_ENCODING || "opus";
const DEEPGRAM_SAMPLE_RATE = parseInt(process.env.DEEPGRAM_SAMPLE_RATE || "16000", 10);

// --- SERVICES ---
const prisma = new PrismaClient({
  datasources: {
    db: { url: process.env.DATABASE_URL },
  },
});
const deepgram = createClient(DEEPGRAM_API_KEY);
const openai = new OpenAI({ apiKey: OPENAI_API_KEY });

(async () => {
  try {
    // FIX: Use the correct v3 SDK syntax for project listing
    const { result, error } = await (deepgram as any).manage.getProjects();
    if (error) throw error;
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

// Secure origin validation for WebSocket upgrade (supports comma-separated ALLOWED_ORIGINS)
server.on("upgrade", (req, socket, head) => {
  const origin = req.headers.origin || "";
  const allowedEnv =
    process.env.ALLOWED_ORIGINS || process.env.ALLOWED_ORIGIN || "";
  const allowedOrigins = allowedEnv
    .split(",")
    .map((o) => o.trim())
    .filter(Boolean);

  const isDev = process.env.NODE_ENV === "development";
  const originAllowed =
    allowedOrigins.includes(origin) ||
    (isDev && origin.startsWith("http://localhost"));
  if (!originAllowed) {
    console.warn(
      `[Security] Denying connection from mismatched origin: "${origin}". Allowed list: ${allowedOrigins.join(",")}`
    );
    socket.destroy();
    return;
  }

  // Parse URL early; only validate it's a valid URL. Guests may omit token.
  try {
    new URL(req.url || "", "http://localhost");
  } catch (e) {
    console.warn(
      "[Upgrade] Invalid URL during upgrade",
      (e as any)?.message || e
    );
    socket.destroy();
    return;
  }

  wss.handleUpgrade(req, socket, head, (ws) => {
    wss.emit("connection", ws, req);
  });
});

// Deepgram helper
async function attemptDeepgramLive(
  label: string,
  cfg: Record<string, any>,
  timeoutMs = 4000
) {
  return new Promise<{ ok: boolean; conn: any; label: string; error?: any }>(
    (resolve) => {
      let settled = false;
      try {
        if (label === "explicit") {
          try {
            console.log(
              "[DG Config - Explicit] Attempting connection with config:",
              JSON.stringify(cfg, null, 2)
            );
          } catch {}
        }
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
          if (settled) return;
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
        if (label === "explicit") {
          console.error(
            `[DG Config - Explicit] SDK listen.live threw error:`,
            (err as any)?.message || err,
            err
          );
        } else {
          console.error(
            `[DG Fallback] 🚫 Exception creating config ${label}:`,
            (err as any)?.message || err
          );
        }
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
  const DG_MODEL = DEEPGRAM_MODEL;
  const base = {
    model: DG_MODEL,
    language: "en-US",
    smart_format: true,
    vad_events: true,
    interim_results: process.env.DG_INTERIM_RESULTS === "true",
    // Configurable silence tolerance (default: 10000ms)
    utterance_end_ms: parseInt(process.env.DG_UTTERANCE_END_MS ?? "10000", 10),
    // Configurable endpointing mode (default: "none")
    endpointing: process.env.DG_ENDPOINTING ?? "none",
  };
  const explicit = {
    ...base,
    encoding: DEEPGRAM_ENCODING,
    // Explicitly include sample rate for Opus streams for robustness.
    // Deepgram typically infers this from the container, but setting it can prevent mis-detection.
    sample_rate: DEEPGRAM_SAMPLE_RATE,
  } as Record<string, any>;
  const minimal = { ...base };
  const attempts: any[] = [];
  // Order attempts based on DEEPGRAM_MODE.
  // explicit: prioritize matching browser (webm/opus) streaming
  // auto: let DG infer, but fall back to explicit
  // any other: default to explicit first
  const order: Array<"explicit" | "auto" | "minimal"> =
    DEEPGRAM_MODE === "auto"
      ? ["auto", "explicit", "minimal"]
      : ["explicit", "auto", "minimal"];

  for (const label of order) {
    const cfg =
      label === "auto"
        ? { model: DG_MODEL, language: "en-US" }
        : label === "explicit"
          ? explicit
          : minimal;
    const res = await attemptDeepgramLive(label, cfg);
    attempts.push(res);
    if (res.ok) break;
  }
  return { mode: DEEPGRAM_MODE, attempts } as const;
}

wss.on("connection", async (ws, req) => {
  let audioChunkCount = 0;
  let totalBytesSent = 0;
  console.log("[Server Log] ✅ New client connected.");
  const url = new URL(req.url!, "http://localhost");
  const conversationId = url.searchParams.get("conversationId");
  const token = url.searchParams.get("token");
  const guestId = url.searchParams.get("guestId");

  if (!conversationId) {
    console.warn("[WS] Closing: missing conversationId in query params");
    ws.close(1008, "Missing conversationId");
    return;
  }

  let userId: string | null = null;
  let isPro = false;
  let effectiveUserId: string | null = guestId || conversationId;

  if (token) {
    try {
      const session = await verifyToken(token, { secretKey: CLERK_SECRET_KEY });
      userId = session?.sub || null;
      if (!userId) throw new Error("No user id in token");
      effectiveUserId = userId;
      const userRecord = await prisma.user.findUnique({
        where: { id: userId },
        include: { subscriptions: { where: { status: "active" } } },
      });
      if (userRecord?.subscriptions?.length) isPro = true;
      console.log(`[Auth] User ${userId} authenticated. Pro=${isPro}`);
    } catch (err) {
      console.error(
        "[Auth] Token verification failed:",
        (err as any)?.message || err
      );
      ws.close(4001, "Authentication failed");
      return;
    }
  } else {
    console.log(
      `[Auth] Guest user connected with guestId: ${guestId} (token present: ${Boolean(
        token
      )})`
    );
  }

  // Ensure conversation exists (id may come from client for continuity)
  try {
    await prisma.conversation.upsert({
      where: { id: conversationId },
      update: {},
      create: { id: conversationId, title: "New Conversation" },
    });
    console.log(`[DB] Upserted conversation with ID: ${conversationId}`);
  } catch (e) {
    console.error(`[DB] Failed to upsert conversation ${conversationId}:`, e);
    ws.close(1011, "Conversation setup failed");
    return;
  }

  const safeSend = (payload: ServerEvent) => {
    if (ws.readyState === WebSocket.OPEN) ws.send(JSON.stringify(payload));
  };

  // Initialize usage tracking for this connection (auth/user resolution TBD => null userId placeholder)
  activeSessions.set(ws, {
    userId: userId,
    guestId: guestId || null,
    conversationId,
    startedAt: Date.now(),
    sessionSeconds: 0,
    secondsUsedToday: 0,
    isPro,
  });

  // Start unified usage interval immediately on connection
  const usageInterval = setInterval(() => {
    const info = activeSessions.get(ws);
    if (!info || info.limitReached) return;
    info.sessionSeconds++;
    if (!info.isPro) {
      info.secondsUsedToday++;
    }
    let limitExceeded = false;
    let reason = "";
    if (info.isPro) {
      if (info.sessionSeconds >= PRO_SESSION_SECONDS) {
        limitExceeded = true;
        reason = "session_limit_exceeded";
      }
    } else {
      if (info.secondsUsedToday >= FREE_TRIAL_SECONDS) {
        limitExceeded = true;
        reason = "daily_limit_exceeded";
      }
    }
    if (limitExceeded) {
      info.limitReached = true;
      console.log(
        `[Usage] User ${info.userId || "anon"} limit reached: ${reason} (session=${info.sessionSeconds}s daily=${info.secondsUsedToday}s)`
      );
      safeSend({ t: "limit_reached", reason } as any);
      try {
        ws.close();
      } catch {}
    }
  }, 1000);
  const createdSession = activeSessions.get(ws);
  if (createdSession) createdSession.interval = usageInterval;

  function cleanupSession() {
    const info = activeSessions.get(ws);
    if (!info) return;
    if (info.interval) clearInterval(info.interval as any);
    const hasUser = !!info.userId;
    const hasGuest = !!(info as any).guestId;
    if (hasUser || hasGuest) {
      const day = new Date();
      day.setHours(0, 0, 0, 0);
      const incrementAmount = info.isPro
        ? info.sessionSeconds
        : info.secondsUsedToday;
      if (prisma.dailyUsage) {
        const where = (
          hasUser
            ? { userId_day: { userId: info.userId as string, day } }
            : { guestId_day: { guestId: (info as any).guestId as string, day } }
        ) as any;
        const create = (
          hasUser
            ? {
                userId: info.userId as string,
                day,
                secondsUsed: incrementAmount,
              }
            : {
                guestId: (info as any).guestId as string,
                day,
                secondsUsed: incrementAmount,
              }
        ) as any;
        prisma.dailyUsage
          .upsert({
            where,
            update: { secondsUsed: { increment: incrementAmount } },
            create,
          })
          .catch((e: any) =>
            console.warn("[Usage] Failed to upsert DailyUsage on cleanup:", e)
          );
      }
    }
    activeSessions.delete(ws);
  }

  let deepgramLive: any = null;
  let deepgramKeepAlive: NodeJS.Timer | null = null;
  let deepgramReopenTimer: NodeJS.Timer | null = null;

  const attachDeepgramHandlers = (conn: any) => {
    // Update buffer on partials with verbose logging
    conn.on("transcriptReceived", async (dgMsg: any) => {
      const text = dgMsg?.channel?.alternatives?.[0]?.transcript || "";
      const isFinal = Boolean(dgMsg?.is_final || dgMsg?.speech_final);
      const hasText = Boolean(text);
      const messageType = dgMsg?.type;
      console.log("[DG] Transcript received:", {
        text,
        isFinal,
        hasText,
        messageType,
      });
      if (hasText) {
        console.log("[STAGE] Speech detected:", text);
        // Always update latest interim/final transcript for flushing on UtteranceEnd
        pendingTranscript = text;
      }
      // If manual EOU triggered finish(), wait for the final result here
      if (isProcessing && isFinal) {
        const finalText = (pendingTranscript || "").trim();
        if (!finalText) {
          console.log(
            "[STAGE] Final transcript empty after EOU. Skipping LLM/TTS and resetting state."
          );
          safeSend({ t: "speak", on: false } as any);
          pendingTranscript = "";
          isProcessing = false;
          safeReopenDeepgram();
          return;
        }
        try {
          await sendTranscriptToOpenAI(finalText);
        } catch (error) {
          console.error("[STAGE] Manual EOU final processing failed:", error);
        } finally {
          pendingTranscript = "";
          isProcessing = false;
          safeReopenDeepgram();
        }
      }
    });
    // Try to log additional DG events if exposed by SDK
    try {
      conn.on("Metadata", () => {
        console.log("[DG Event] Received Metadata");
      });
    } catch {}
    try {
      conn.on("message", (data: any) => {
        try {
          const parsed = JSON.parse(data?.toString?.() || "");
          console.log("[DG Receive] Received message type:", parsed?.type);
        } catch {
          console.log("[DG Receive] Non-JSON message received");
        }
      });
    } catch {}
    // Use Deepgram's automatic UtteranceEnd
    conn.on("UtteranceEnd", async () => {
      if (isProcessing) {
        console.log("[STAGE] Skipping - already processing");
        return;
      }

      const text = (pendingTranscript || "").trim();
      if (!text) {
        console.log("[STAGE] No transcript to process");
        return;
      }

      console.log("[STAGE] Processing utterance:", text);
      isProcessing = true;

      try {
        await sendTranscriptToOpenAI(text);
        pendingTranscript = "";
      } catch (error) {
        console.error("[STAGE] Processing failed:", error);
      } finally {
        isProcessing = false;
      }
    });
  };

  async function openDeepgramConnection() {
    if (DEEPGRAM_DISABLED) {
      console.warn("[DG] Deepgram disabled via DEEPGRAM_DISABLED env var");
      return;
    }
    try {
      const primary = await initDeepgramWithMode();
      const successAttempt = (primary as any).attempts?.find((a: any) => a.ok);
      if (successAttempt) {
        console.log(`[DG] Connected with ${successAttempt.label} config`);
        deepgramLive = successAttempt.conn;
        console.log("[DG] ✅ Deepgram connection established successfully");
      } else {
        throw new Error(
          "All Deepgram connection attempts failed after reordering."
        );
      }
      deepgramLive.on("open", () => {
        console.log("[DG] WebSocket connection opened");
        console.log("[STAGE] Listening for speech...");
      });
      deepgramLive.on("close", async (code: any, reason: any) => {
        const reasonString = Buffer.isBuffer(reason)
          ? reason.toString("utf8")
          : reason?.toString?.() || "No reason provided";
        console.log(
          `[DG Close Handler] Deepgram stream closed: ${code}. Reason: ${reasonString}`
        );
        // If currently processing due to EOU finish, finalize based on accumulated transcript
        if (isProcessing) {
          const finalText = (pendingTranscript || "").trim();
          if (!finalText) {
            console.log(
              "[DG Close Handler] Final transcript empty after finish(). Signaling completion and reopening."
            );
            safeSend({ t: "speak", on: false } as any);
            pendingTranscript = "";
            isProcessing = false;
            safeReopenDeepgram();
          } else {
            try {
              await sendTranscriptToOpenAI(finalText);
            } catch (e) {
              console.error(
                "[DG Close Handler] Final processing failed after close:",
                e
              );
            } finally {
              pendingTranscript = "";
              isProcessing = false;
              safeReopenDeepgram();
            }
          }
        } else {
          // If not currently in the middle of processing (planned finish), proactively end the turn
          console.log(
            "[DG Close Handler] Proactively signaling turn completion to client."
          );
          // 1) Signal completion so client doesn't timeout
          safeSend({ t: "speak", on: false } as any);
          // 2) Reset state
          pendingTranscript = "";
          isProcessing = false;
          // 3) Re-open Deepgram for the next utterance
          try {
            safeReopenDeepgram();
          } catch (e) {
            console.error(
              "[DG Reopen] Failed to re-initialize Deepgram after unexpected close:",
              e
            );
          }
        }
      });
      deepgramLive.on("error", (e: any) => {
        console.error("[DG Error] Deepgram stream error:", e?.message || e);
        // Optionally, could signal speak:false here as well if desired
      });
      if (deepgramKeepAlive) {
        clearInterval(deepgramKeepAlive as any);
        deepgramKeepAlive = null;
      }
      deepgramKeepAlive = setInterval(() => {
        try {
          if (deepgramLive?.getReadyState?.() === 1)
            deepgramLive.send(JSON.stringify({ type: "KeepAlive" }));
        } catch {}
      }, 8000);
      const clearKA = () => {
        if (deepgramKeepAlive) {
          clearInterval(deepgramKeepAlive as any);
          deepgramKeepAlive = null;
        }
      };
      ws.on("close", clearKA);
      ws.on("error", clearKA);

      attachDeepgramHandlers(deepgramLive);
    } catch (err) {
      console.error(
        "[DG] Failed to connect after retries:",
        (err as any)?.message || err
      );
      safeSend({ t: "error", message: "Speech recognition unavailable." });
    }
  }

  const safeReopenDeepgram = (delayMs = 500) => {
    // Debounce re-open attempts
    if (deepgramReopenTimer) return;
    deepgramReopenTimer = setTimeout(() => {
      deepgramReopenTimer = null;
      let state: any;
      try {
        state = deepgramLive?.getReadyState?.();
      } catch {}
      // If no connection or CLOSED (3), open a new one
      if (!deepgramLive || state === 3) {
        try {
          openDeepgramConnection();
        } catch (e) {
          console.error("[DG Reopen] Failed to re-open Deepgram:", e);
        }
        return;
      }
      // If not OPEN (1) but still present (e.g., CLOSING/CONNECTING), attempt a graceful finish
      if (state !== 1) {
        try {
          (deepgramLive as any)?.finish?.();
        } catch {}
        // Schedule another attempt after delay, allowing close to complete
        safeReopenDeepgram(delayMs);
      }
      // If OPEN, do nothing
    }, delayMs);
  };

  await openDeepgramConnection();

  // Reset per-connection state
  let pendingTranscript = "";
  let isProcessing = false;
  let assistantBusy = false;

  // Helper to respond using current conversation memory and TTS
  const sendTranscriptToOpenAI = async (finalText: string) => {
    try {
      const session = activeSessions.get(ws);
      // Allow empty transcripts; provide a graceful fallback prompt
      let effectiveText = (finalText ?? "").trim();
      if (!effectiveText) {
        effectiveText = "Sorry, I didn't catch that. Could you please repeat?";
      }
      if (assistantBusy) {
        console.log("[Server Log] Skipping; assistant is busy.");
        return;
      }
      if (session?.limitReached) return;

      console.log("[STAGE] Starting OpenAI processing");
      assistantBusy = true;
      safeSend({ t: "transcript", text: effectiveText });

      await prisma.message
        .create({ data: { conversationId, role: "user", text: effectiveText } })
        .catch((e) => console.error("[DB] Failed to save user message:", e));

      // Load last 10 messages
      let history: { role: string; text: string }[] = [];
      try {
        const recent = await prisma.message.findMany({
          where: { conversationId },
          orderBy: { createdAt: "desc" },
          take: 10,
        });
        history = recent.reverse();
      } catch (e) {
        console.warn(
          "[Memory] Failed to load history (continuing without):",
          e
        );
      }

      const messagesForAPI: Array<{
        role: "system" | "user" | "assistant";
        content: string;
      }> = [
        { role: "system", content: PERSONALITY_PROMPT },
        ...history.map((m) => ({
          role: (m.role === "assistant" ? "assistant" : "user") as
            | "user"
            | "assistant",
          content: m.text,
        })),
        // Current user input (possibly a graceful fallback text)
        { role: "user", content: effectiveText },
      ];
      let fullResponse = "";

      const speechConfig = AzureSpeechSDK.SpeechConfig.fromSubscription(
        AZURE_SPEECH_KEY,
        AZURE_SPEECH_REGION
      );
      speechConfig.speechSynthesisOutputFormat =
        AzureSpeechSDK.SpeechSynthesisOutputFormat.Webm24Khz16BitMonoOpus;
      speechConfig.speechSynthesisVoiceName = AZURE_TTS_VOICE;
      const synthesizer = new AzureSpeechSDK.SpeechSynthesizer(
        speechConfig,
        undefined
      );

      function escapeXml(s: string) {
        return s
          .replace(/&/g, "&amp;")
          .replace(/</g, "&lt;")
          .replace(/>/g, "&gt;")
          .replace(/"/g, "&quot;")
          .replace(/'/g, "&apos;");
      }

      const synthesizeSentence = (sentence: string): Promise<void> => {
        const cleaned = cleanTextForTTS(sentence);
        if (!cleaned) return Promise.resolve();
        const ssml = `<?xml version="1.0" encoding="UTF-8"?>\n<speak version="1.0" xml:lang="en-US"><voice name="${AZURE_TTS_VOICE}"><prosody rate="${AZURE_TTS_RATE}" pitch="${AZURE_TTS_PITCH}">${escapeXml(
          cleaned
        )}</prosody></voice></speak>`;
        return new Promise((resolve, reject) => {
          synthesizer.speakSsmlAsync(
            ssml,
            (result) => {
              if (
                result.reason ===
                AzureSpeechSDK.ResultReason.SynthesizingAudioCompleted
              ) {
                if ((result as any).audioData) {
                  console.log(
                    `[Server Log] Received audio chunk. Size: ${result.audioData.byteLength}`
                  );
                  safeSend({
                    t: "tts_chunk",
                    b64: Buffer.from((result as any).audioData).toString(
                      "base64"
                    ),
                  });
                }
                resolve();
              } else {
                console.error(
                  `[Server Log] Azure TTS Error. Reason: ${result.reason}. Details: ${result.errorDetails}`
                );
                reject(new Error(result.errorDetails));
              }
            },
            (error) => {
              console.error(
                "[Server Log] speakSsmlAsync error callback:",
                error
              );
              reject(error);
            }
          );
        });
      };

      try {
        console.log("[Server Log] Sending transcript to OpenAI...");
        console.log(`[AI Request] Sending transcript to AI: "${finalText}"`);
        console.log("[STAGE] Streaming LLM response");
        const stream = await openai.chat.completions.create({
          model: "gpt-4o-mini",
          messages: messagesForAPI,
          stream: true,
        });

        for await (const chunk of stream) {
          const content = (chunk as any).choices[0]?.delta?.content || "";
          if (content) {
            fullResponse += content;
            safeSend({ t: "assistant_text_chunk", text: content });
          }
        }
        console.log(
          `[Server Log] OpenAI stream finished. Full response: "${fullResponse}"`
        );

        const cleanedFull = cleanTextForTTS(fullResponse);
        if (cleanedFull) {
          safeSend({ t: "speak", on: true });
          console.log("[STAGE] Starting TTS synthesis");
          safeSend({ t: "tts_start" });
          console.log(
            `[Server Log] Synthesizing full response (${cleanedFull.length} chars).`
          );
          try {
            await synthesizeSentence(cleanedFull);
          } catch (e) {
            console.error("[TTS] Full response synthesis failed:", e);
          }
        }
      } catch (err) {
        console.error("[Server Log] OpenAI/TTS Error:", err);
        safeSend({ t: "error", message: "Sorry, I had trouble responding." });
      } finally {
        safeSend({ t: "tts_end" });
        synthesizer.close();
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
        console.log("[STAGE] Pipeline complete");
      }
    } catch (outerErr) {
      console.error("[Server Log] FATAL processing utterance:", outerErr);
      safeSend({ t: "error", message: "Internal processing error." });
      assistantBusy = false;
    }
  };

  // Deepgram event handlers are attached within openDeepgramConnection()

  ws.on("message", (message: Buffer, isBinary) => {
    if (isBinary) {
      console.log("[WS] Received binary audio chunk:", message.length, "bytes");
    }
    if (isBinary) {
      if (!deepgramLive) return;
      audioChunkCount++;
      totalBytesSent += message.length;
      try {
        if ((deepgramLive as any).getReadyState?.() === 1)
          (deepgramLive as any).send(message);
      } catch (err) {
        console.error("[DG] send error", (err as any)?.message || err);
      }
      return;
    }
    // TEXT MESSAGES - handle manual End Of Utterance from client
    try {
      const text = message.toString("utf8");
      const data = JSON.parse(text);

      if (data?.t === "eou") {
        console.log("[STAGE] Received manual EOU from client");

        if (isProcessing) {
          console.log("[STAGE] Manual EOU ignored - already processing");
          return;
        }

        // Set processing state now to prevent concurrent EOU processing
        isProcessing = true;
        // Stop Deepgram stream to flush and emit final transcript asynchronously
        try {
          deepgramLive?.finish();
        } catch {}
        // Do NOT process synchronously here; wait for final transcript via event handlers
      } // <--- 1. CLOSES: if (data?.t === "eou")
    } catch (e) {
      console.warn("[WS] Ignored non-JSON message:", e);
    }
  }); // <--- 2. CLOSES: ws.on('message', (message, isBinary) => { ... })
  ws.on("close", (code, reason) => {
    console.log("[Server Log] Client disconnected.", {
      code,
      reason: Buffer.isBuffer(reason) ? reason.toString("utf8") : reason,
    });
    try {
      (deepgramLive as any)?.finish?.();
    } catch {}
    cleanupSession();
  });
  ws.on("error", (error) => {
    console.error("[Server Log] WebSocket Error:", error);
    try {
      (deepgramLive as any)?.finish?.();
    } catch {}
    cleanupSession();
  });
}); // <--- 3. CLOSES: wss.on('connection', (ws, req) => { ... })

server.listen(PORT, () => {
  console.log(`🚀 Voice pipeline server listening on :${PORT}`);
});
