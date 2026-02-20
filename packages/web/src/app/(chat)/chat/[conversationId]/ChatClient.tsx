"use client";

import { useAuth, useClerk } from "@clerk/nextjs";
import { useCallback, useEffect, useRef, useState } from "react";
import { useKiraSocket, debugLog } from "@/hooks/useKiraSocket";
import { PhoneOff, Star, User, Mic, MicOff, Eye, EyeOff, Clock, Sparkles, Camera, Scissors, Download, X, Share2, Paintbrush } from "lucide-react";
import ProfileModal from "@/components/ProfileModal";
import KiraOrb from "@/components/KiraOrb";
import { getOrCreateGuestId } from "@/lib/guestId";
import { getVoicePreference, setVoicePreference, VoicePreference } from "@/lib/voicePreference";
import { KiraLogo } from "@/components/KiraLogo";
import { useClipRecorder } from "@/hooks/useClipRecorder";
import dynamic from "next/dynamic";

const Live2DAvatar = dynamic(() => import("@/components/Live2DAvatar"), { ssr: false });
const XOLoader = dynamic(() => import("@/components/XOLoader"), { ssr: false });

export default function ChatClient() {
  const { getToken, userId, isLoaded: clerkLoaded } = useAuth();
  const { openSignIn } = useClerk();
  const [showRatingModal, setShowRatingModal] = useState(false);
  const hasShownRating = useRef(false); // Prevent rating dialog from showing twice
  const [showProfileModal, setShowProfileModal] = useState(false);
  const [rating, setRating] = useState(0);
  const [hoverRating, setHoverRating] = useState(0);
  const [guestId, setGuestId] = useState("");
  const [voicePreference, setVoicePref] = useState<VoicePreference>("anime");
  const [visualMode, setVisualMode] = useState<"avatar" | "orb">("avatar");
  const [isSceneActive, setIsSceneActive] = useState(false);
  const [live2dReady, setLive2dReady] = useState(false);
  const [live2dFailed, setLive2dFailed] = useState(false);
  const [live2dDismissed, setLive2dDismissed] = useState(false); // set true before WS close to clean up PIXI first
  const isDisconnectingRef = useRef(false); // prevents orb fallback flash during clean shutdown
  const [isMobile, setIsMobile] = useState(false);
  const [deviceDetected, setDeviceDetected] = useState(false);
  const live2dRetryCount = useRef(0);
  const MAX_LIVE2D_RETRIES = 1;
  const live2dLoadTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const live2dRetryInterval = useRef<ReturnType<typeof setInterval> | null>(null);
  const MODEL_LOAD_TIMEOUT = 8000; // 8 seconds

  // --- Clip recorder ---
  const clipRecorder = useClipRecorder();
  const live2dCanvasRef = useRef<HTMLCanvasElement | null>(null);
  const clipBufferStarted = useRef(false);

  // --- Debug: track mount/unmount and what triggers remount ---
  useEffect(() => {
    debugLog("[ChatClient] MOUNTED. URL:", window.location.href, "userId:", userId, "clerkLoaded:", clerkLoaded);
    return () => {
      debugLog("[ChatClient] UNMOUNTING. URL:", window.location.href);
    };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // --- Debug: track Clerk auth state changes (userId flipping can cause subtree re-renders) ---
  const prevUserId = useRef(userId);
  useEffect(() => {
    if (prevUserId.current !== userId) {
      debugLog("[ChatClient] userId changed:", prevUserId.current, "→", userId);
      prevUserId.current = userId;
    }
  }, [userId]);

  // --- Debug: track Clerk isLoaded change ---
  useEffect(() => {
    debugLog("[ChatClient] clerkLoaded changed to:", clerkLoaded, "userId:", userId);
  }, [clerkLoaded, userId]);

  useEffect(() => {
    const checkMobile = () => {
      const mobile =
        /iPhone|iPad|iPod|Android/i.test(navigator.userAgent) ||
        (navigator.maxTouchPoints > 0 && window.innerWidth < 768);
      setIsMobile(mobile);
      setDeviceDetected(true);
    };
    checkMobile();
    window.addEventListener("resize", checkMobile);

    // Fallback re-check: guarantee detection even if the initial check raced
    const fallback = setTimeout(checkMobile, 2000);

    return () => {
      window.removeEventListener("resize", checkMobile);
      clearTimeout(fallback);
    };  
  }, []);

  // If Live2D fails to load (e.g. mobile GPU limits), auto-switch to orb
  // Skip fallback during clean disconnect — just let the component unmount
  useEffect(() => {
    if (live2dFailed && visualMode === "avatar" && !isDisconnectingRef.current) {
      setVisualMode("orb");
      debugLog("[UI] Live2D failed — falling back to orb mode");
    }
  }, [live2dFailed, visualMode]);

  // Live2D loading timeout: if model hasn't loaded in 8s, fall back to orb gracefully
  useEffect(() => {
    if (visualMode === "avatar" && !live2dReady && !live2dFailed) {
      live2dLoadTimer.current = setTimeout(() => {
        if (!live2dReady) {
          debugLog("[Live2D] Model load timeout (8s) — using orb fallback");
          setLive2dFailed(true);
        }
      }, MODEL_LOAD_TIMEOUT);
    }
    return () => {
      if (live2dLoadTimer.current) {
        clearTimeout(live2dLoadTimer.current);
        live2dLoadTimer.current = null;
      }
    };
  }, [visualMode, live2dReady, live2dFailed]);

  // Background retry: after orb fallback, keep trying to load Live2D every 15s
  useEffect(() => {
    if (visualMode === "orb" && live2dFailed && !isDisconnectingRef.current) {
      live2dRetryInterval.current = setInterval(() => {
        if (live2dReady) {
          if (live2dRetryInterval.current) clearInterval(live2dRetryInterval.current);
          return;
        }
        debugLog("[Live2D] Retrying model load...");
        setLive2dFailed(false);
        setLive2dReady(false);
        setVisualMode("avatar");
      }, 15000);
    }
    return () => {
      if (live2dRetryInterval.current) {
        clearInterval(live2dRetryInterval.current);
        live2dRetryInterval.current = null;
      }
    };
  }, [visualMode, live2dFailed, live2dReady]);

  // Load guest ID, voice preference, and scene preference from localStorage
  useEffect(() => {
    if (!userId) {
      setGuestId(getOrCreateGuestId());
    }
    setVoicePref(getVoicePreference());
    try {
      const saved = localStorage.getItem("kira-scene-active");
      if (saved === "true") setIsSceneActive(true);
    } catch {}
  }, [userId]);

  const { 
    connect, 
    disconnect,
    signalVisualReady,
    socketState, 
    kiraState, 
    micVolume, 
    error,
    sendVoiceChange,
    isAudioBlocked, 
    resumeAudio,
    isMuted,
    toggleMute,
    isScreenSharing,
    startScreenShare,
    stopScreenShare,
    isCameraActive,
    cameraStreamRef,
    facingMode,
    startCamera,
    stopCamera,
    flipCamera,
    isPro,
    remainingSeconds,
    isAudioPlaying,
    playerVolume,
    playbackAnalyserNode,
    mediaStreamDestNode,
    currentExpression,
    activeAccessories,
    currentAction,
    connectionStatus
  } = useKiraSocket(
    userId ? getToken : null,
    guestId,
    voicePreference
  );

  // Orb mode is always "visually ready" — signal immediately so start_stream isn't blocked
  useEffect(() => {
    if (visualMode === "orb") {
      signalVisualReady();
    }
  }, [visualMode, signalVisualReady]);

  // ─── Clip recorder: start rolling buffer once canvas + audio are available ───
  useEffect(() => {
    if (
      socketState === "connected" &&
      live2dCanvasRef.current &&
      mediaStreamDestNode &&
      !clipBufferStarted.current
    ) {
      clipRecorder.startRollingBuffer(live2dCanvasRef.current, mediaStreamDestNode);
      clipBufferStarted.current = true;
      debugLog("[Clip] Rolling buffer started");
    }
  }, [socketState, mediaStreamDestNode, clipRecorder]);

  // ─── Clip recorder: stop when conversation ends ───
  useEffect(() => {
    if (socketState === "closed" || socketState === "idle") {
      if (clipBufferStarted.current) {
        clipRecorder.stopRollingBuffer();
        clipBufferStarted.current = false;
        debugLog("[Clip] Rolling buffer stopped");
      }
    }
  }, [socketState, clipRecorder]);

  // ─── Clip share modal auto-dismiss after 30 seconds ───
  useEffect(() => {
    if (!clipRecorder.clipUrl) return;
    const timer = setTimeout(() => {
      clipRecorder.setClipUrl(null);
    }, 30_000);
    return () => clearTimeout(timer);
  }, [clipRecorder.clipUrl, clipRecorder]);

  const handleClip = useCallback(async () => {
    const url = await clipRecorder.saveClip();
    if (url) {
      debugLog("[Clip] Clip saved:", url);
    } else {
      debugLog("[Clip] No clip data available");
    }
  }, [clipRecorder]);

  const toggleScene = useCallback(() => {
    setIsSceneActive((prev) => {
      const next = !prev;
      try { localStorage.setItem("kira-scene-active", String(next)); } catch {}
      return next;
    });
  }, []);

  // ─── Camera PIP preview ───
  const previewVideoRef = useRef<HTMLVideoElement>(null);
  const [pipPosition, setPipPosition] = useState({ x: 16, y: 140 }); // offset from bottom-right
  const [pipSize, setPipSize] = useState({ w: 112, h: 150 }); // 40% larger than original 80x107
  const [pipMinimized, setPipMinimized] = useState(false);
  const pipDragRef = useRef<{ startX: number; startY: number; origX: number; origY: number } | null>(null);
  const pipResizeRef = useRef<{ startX: number; startY: number; origW: number; origH: number } | null>(null);
  const PIP_ASPECT = 3 / 4; // width / height (3:4 portrait)
  const PIP_MIN_H = 120;
  const PIP_MAX_H = 400;

  // Attach stream to video element whenever camera becomes active
  useEffect(() => {
    if (!isCameraActive) {
      // Reset PIP position and size when camera stops
      setPipPosition({ x: 16, y: 140 });
      setPipSize({ w: 112, h: 150 });
      setPipMinimized(false);
      return;
    }
    const vid = previewVideoRef.current;
    const stream = cameraStreamRef.current;
    if (vid && stream) {
      vid.srcObject = stream;
      vid.setAttribute("playsinline", "true");
      vid.muted = true;
      vid.play().catch(() => {});
    }
  }, [isCameraActive, cameraStreamRef]);

  const handlePipTouchStart = useCallback((e: React.TouchEvent) => {
    const touch = e.touches[0];
    pipDragRef.current = {
      startX: touch.clientX,
      startY: touch.clientY,
      origX: pipPosition.x,
      origY: pipPosition.y,
    };
  }, [pipPosition]);

  const handlePipTouchMove = useCallback((e: React.TouchEvent) => {
    if (!pipDragRef.current) return;
    const touch = e.touches[0];
    const dx = touch.clientX - pipDragRef.current.startX;
    const dy = touch.clientY - pipDragRef.current.startY;
    setPipPosition({
      x: pipDragRef.current.origX - dx, // right offset: drag right → decrease right → moves right ✓
      y: pipDragRef.current.origY - dy,  // bottom offset: drag down → decrease bottom → moves down ✓
    });
  }, []);

  const handlePipTouchEnd = useCallback(() => {
    pipDragRef.current = null;
  }, []);

  // ─── PIP resize handlers (bottom-left corner, since PIP is anchored to bottom-right) ───
  const handleResizeStart = useCallback((e: React.TouchEvent | React.PointerEvent) => {
    e.stopPropagation();
    const clientX = "touches" in e ? e.touches[0].clientX : e.clientX;
    const clientY = "touches" in e ? e.touches[0].clientY : e.clientY;
    pipResizeRef.current = { startX: clientX, startY: clientY, origW: pipSize.w, origH: pipSize.h };
  }, [pipSize]);

  const handleResizeMove = useCallback((e: React.TouchEvent | React.PointerEvent) => {
    if (!pipResizeRef.current) return;
    e.stopPropagation();
    const clientX = "touches" in e ? e.touches[0].clientX : e.clientX;
    const clientY = "touches" in e ? e.touches[0].clientY : e.clientY;
    // Resize handle is bottom-left: dragging left/down = bigger, right/up = smaller
    const dx = pipResizeRef.current.startX - clientX; // left = positive = bigger
    const dy = clientY - pipResizeRef.current.startY; // down = positive = bigger
    const delta = Math.max(dx, dy); // Use the larger of the two to maintain feel
    const newH = Math.min(PIP_MAX_H, Math.max(PIP_MIN_H, pipResizeRef.current.origH + delta));
    const newW = Math.round(newH * PIP_ASPECT);
    setPipSize({ w: newW, h: newH });
  }, []);

  const handleResizeEnd = useCallback(() => {
    pipResizeRef.current = null;
  }, []);

  // ─── start_stream is now sent atomically in the hook's onopen handler ───
  // No more useEffect race — connect() → WS open → start_stream → audio pipeline
  // all happen in the same call stack, immune to React remounts.

  // ─── DO NOT disconnect on unmount ───
  // React can remount this component at any time (Clerk auth, Next.js RSC, etc.).
  // The WebSocket lives in a module-level singleton and survives remounts.
  // Only handleEndCall() → disconnect() closes the WS intentionally.
  useEffect(() => {
    return () => {
      debugLog("[ChatClient] Unmount cleanup — WS stays alive in singleton");
      // Just clean up Live2D visuals, don't touch the WebSocket
      isDisconnectingRef.current = true;
      setLive2dDismissed(true);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // --- UI Logic ---

  const handleEndCall = async () => {
    // 0. Stop clip recorder
    clipRecorder.stopRollingBuffer();
    clipBufferStarted.current = false;
    // 1. Mark disconnecting to prevent orb fallback flash
    isDisconnectingRef.current = true;
    // 2. Unmount Live2D first so PIXI can destroy its WebGL context cleanly
    setLive2dDismissed(true);
    // 3. Give the browser time to flush the React unmount + release GPU memory.
    //    500ms is generous but mobile browsers need it to actually free VRAM
    //    after WEBGL_lose_context before a new context can be created.
    await new Promise(r => setTimeout(r, 500));
    // 4. Then close WebSocket
    disconnect();
    if (!hasShownRating.current) {
      hasShownRating.current = true;
      setShowRatingModal(true);
    }
  };

  const handleRate = () => {
    // TODO: Save rating to backend
    debugLog("User rated conversation:", rating);
    setShowRatingModal(false);
    window.location.href = "/"; // Hard nav to guarantee WebGL cleanup
  };

  const handleContinue = () => {
    setShowRatingModal(false);
    window.location.href = "/"; // Hard nav to guarantee WebGL cleanup
  };

  const handleUpgrade = async () => {
    try {
      const res = await fetch("/api/stripe/checkout", { method: "POST" });
      if (res.ok) {
        const data = await res.json();
        window.location.href = data.url;
      } else {
        console.error("Failed to start checkout");
      }
    } catch (error) {
      console.error("Checkout error:", error);
    }
  };

  const isGuest = !userId;

  const handleSignUp = () => {
    // Pass guestId via unsafe_metadata so the Clerk webhook can migrate the conversation
    openSignIn({
      afterSignInUrl: window.location.href,
      afterSignUpUrl: window.location.href,
    });
    // Note: guestId is preserved in localStorage — on next connect as signed-in user,
    // the webhook will have already migrated the buffer
  };

  // --- Local countdown for time remaining ---
  const [localRemaining, setLocalRemaining] = useState<number | null>(null);

  // Sync from server when session_config arrives
  useEffect(() => {
    if (remainingSeconds !== null) {
      setLocalRemaining(remainingSeconds);
    }
  }, [remainingSeconds]);

  // Tick down every second while connected
  useEffect(() => {
    if (socketState !== "connected" || localRemaining === null) return;
    const interval = setInterval(() => {
      setLocalRemaining((prev) => (prev !== null && prev > 0 ? prev - 1 : 0));
    }, 1000);
    return () => clearInterval(interval);
  }, [socketState, localRemaining !== null]);

  // Dump persistent debug logs from sessionStorage (survives page reloads)
  useEffect(() => {
    if (socketState === "idle") {
      try {
        const raw = sessionStorage.getItem('kira-debug');
        if (raw) {
          const logs = JSON.parse(raw) as string[];
          debugLog(`%c[DebugDump] ${logs.length} stored logs:`, 'color: orange; font-weight: bold');
          logs.forEach((l) => debugLog(l));
        }
      } catch {}
    }
  }, [socketState]);

  // Start Screen (Initial State for ALL users)
  if (socketState === "idle") {
    return (
      <div style={{
        minHeight: "100vh",
        background: "#0D1117",
        display: "flex",
        flexDirection: "column",
        alignItems: "center",
        justifyContent: "center",
        fontFamily: "'DM Sans', -apple-system, BlinkMacSystemFont, sans-serif",
        padding: "24px",
        textAlign: "center",
        position: "relative",
      }}>
        {/* Subtle ambient glow */}
        <div style={{
          position: "absolute",
          top: "40%",
          left: "50%",
          transform: "translate(-50%, -50%)",
          width: 400,
          height: 400,
          borderRadius: "50%",
          background: "radial-gradient(circle, rgba(107,125,179,0.05) 0%, transparent 70%)",
          pointerEvents: "none",
        }} />

        {/* Mic icon badge */}
        <div style={{
          width: 64,
          height: 64,
          borderRadius: 16,
          background: "linear-gradient(135deg, rgba(107,125,179,0.12), rgba(107,125,179,0.04))",
          border: "1px solid rgba(107,125,179,0.15)",
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          marginBottom: 28,
          position: "relative",
        }}>
          <svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="rgba(139,157,195,0.7)" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
            <path d="M12 2a3 3 0 0 0-3 3v7a3 3 0 0 0 6 0V5a3 3 0 0 0-3-3Z" />
            <path d="M19 10v2a7 7 0 0 1-14 0v-2" />
            <line x1="12" y1="19" x2="12" y2="22" />
          </svg>
        </div>

        <h2 style={{
          fontSize: 22,
          fontFamily: "'Playfair Display', serif",
          fontWeight: 400,
          color: "#E2E8F0",
          marginBottom: 10,
          marginTop: 0,
          position: "relative",
        }}>
          Enable your microphone
        </h2>

        <p style={{
          fontSize: 15,
          fontWeight: 300,
          color: "rgba(201,209,217,0.45)",
          lineHeight: 1.6,
          maxWidth: 340,
          marginBottom: 32,
          position: "relative",
        }}>
          Kira needs microphone access to hear you.
          Your audio is never stored or recorded.
        </p>

        <button
          onClick={() => { debugLog("[Chat] 🎤 Connect button tapped"); connect(); }}
          style={{
            display: "flex",
            alignItems: "center",
            gap: 10,
            padding: "14px 36px",
            borderRadius: 12,
            background: "linear-gradient(135deg, rgba(107,125,179,0.2), rgba(107,125,179,0.08))",
            border: "1px solid rgba(107,125,179,0.25)",
            color: "#C9D1D9",
            fontSize: 15,
            fontWeight: 500,
            cursor: "pointer",
            transition: "all 0.3s ease",
            fontFamily: "'DM Sans', sans-serif",
            boxShadow: "0 0 30px rgba(107,125,179,0.08)",
            position: "relative",
          }}
          onMouseEnter={(e) => {
            e.currentTarget.style.background = "linear-gradient(135deg, rgba(107,125,179,0.3), rgba(107,125,179,0.15))";
            e.currentTarget.style.boxShadow = "0 0 40px rgba(107,125,179,0.15)";
            e.currentTarget.style.transform = "translateY(-1px)";
          }}
          onMouseLeave={(e) => {
            e.currentTarget.style.background = "linear-gradient(135deg, rgba(107,125,179,0.2), rgba(107,125,179,0.08))";
            e.currentTarget.style.boxShadow = "0 0 30px rgba(107,125,179,0.08)";
            e.currentTarget.style.transform = "translateY(0)";
          }}
        >
          Allow microphone
        </button>
      </div>
    );
  }

  return (
    <div style={{ background: "#0D1117", fontFamily: "'DM Sans', -apple-system, BlinkMacSystemFont, sans-serif", height: "100dvh" }} className="flex flex-col items-center justify-center w-full">
      {/* Header */}
      <div className="absolute top-0 left-0 right-0 p-6 flex justify-between items-center z-20">
        <a href="/">
          <span className="font-medium text-lg flex items-center gap-2" style={{ color: "#C9D1D9" }}>
            <KiraLogo size={24} id="chatXO" />
            Kira
          </span>
        </a>
        
        {/* Profile Link + Timer */}
        <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
          {/* Timer — only shows under 5 min remaining for free users */}
          {!isPro && localRemaining !== null && localRemaining <= 300 && localRemaining > 0 && (
            <span
              style={{
                fontSize: 12,
                fontWeight: 300,
                fontFamily: "'DM Sans', sans-serif",
                color: `rgba(201,209,217,${localRemaining <= 120 ? 0.5 : 0.25})`,
                letterSpacing: "0.06em",
              }}
            >
              {Math.floor(localRemaining / 60)}:{String(localRemaining % 60).padStart(2, "0")}
            </span>
          )}
          {/* Voice selector */}
          <div style={{
            display: "flex",
            borderRadius: 8,
            overflow: "hidden",
            border: "1px solid rgba(201,209,217,0.12)",
          }}>
            {(["anime", "natural"] as const).map((v) => (
              <button
                key={v}
                onClick={() => {
                  setVoicePref(v);
                  setVoicePreference(v);
                  sendVoiceChange(v);
                }}
                style={{
                  padding: "4px 10px",
                  fontSize: 11,
                  fontWeight: voicePreference === v ? 500 : 300,
                  fontFamily: "'DM Sans', sans-serif",
                  background: voicePreference === v ? "rgba(107,125,179,0.25)" : "transparent",
                  color: voicePreference === v ? "#C9D1D9" : "rgba(201,209,217,0.4)",
                  border: "none",
                  cursor: "pointer",
                  letterSpacing: "0.04em",
                  textTransform: "capitalize",
                  transition: "all 0.2s ease",
                }}
              >
                {v}
              </button>
            ))}
          </div>
          {/* Profile icon */}
          <button 
            onClick={() => setShowProfileModal(true)}
            className="p-2 rounded-full transition-colors"
            style={{ background: "none", border: "none", cursor: "pointer" }}
            onMouseEnter={(e) => { e.currentTarget.style.background = "rgba(255,255,255,0.08)"; }}
            onMouseLeave={(e) => { e.currentTarget.style.background = "none"; }}
          >
              <User size={24} style={{ color: "rgba(201,209,217,0.6)" }} />
          </button>
        </div>
      </div>

      {/* Profile Modal */}
      <ProfileModal 
        isOpen={showProfileModal} 
        onClose={() => setShowProfileModal(false)} 
        isPro={isPro}
      />

      {/* Main Content Area — orb/avatar centered */}
      <div className="flex-grow relative w-full max-w-4xl mx-auto" style={{ minHeight: 0, overflow: "hidden", zIndex: 1 }}>
        {/* Animated scene background — behind everything */}
        {isSceneActive && visualMode === "avatar" && (
          <video
            src="/models/Suki/pink-night.mp4"
            autoPlay
            loop
            muted
            playsInline
            style={{
              position: "absolute",
              inset: 0,
              width: "100%",
              height: "100%",
              objectFit: "cover",
              zIndex: 0,
              opacity: 0.85,
              pointerEvents: "none",
              borderRadius: 0,
            }}
          />
        )}
        {/* Visual — absolutely centered */}
        <div className="absolute inset-0 flex items-center justify-center pointer-events-none" style={{ paddingBottom: isMobile ? 140 : 160 }}>
          <div className="pointer-events-auto" style={{ width: visualMode === "avatar" ? "100%" : undefined, height: visualMode === "avatar" ? "100%" : undefined, position: visualMode === "avatar" ? "relative" : undefined, maxHeight: "100%" }}>
            {visualMode === "avatar" ? (
              <>
                {!live2dReady && <XOLoader />}
                {!live2dDismissed && (
                    <Live2DAvatar
                      isSpeaking={isAudioPlaying}
                      analyserNode={playbackAnalyserNode}
                      emotion={currentExpression}
                      accessories={activeAccessories}
                      action={currentAction}
                      isSceneActive={isSceneActive}
                      onModelReady={() => {
                        setLive2dReady(true);
                        signalVisualReady();
                      }}
                      onLoadError={() => setLive2dFailed(true)}
                      onCanvasReady={(canvas) => {
                        live2dCanvasRef.current = canvas;
                        // Start clip buffer if audio dest is already available
                        if (mediaStreamDestNode && !clipBufferStarted.current && socketState === "connected") {
                          clipRecorder.startRollingBuffer(canvas, mediaStreamDestNode);
                          clipBufferStarted.current = true;
                          debugLog("[Clip] Rolling buffer started (from canvas ready)");
                        }
                      }}
                    />
                )}
              </>
            ) : (
              <KiraOrb
                state={
                  isAudioPlaying
                    ? "kiraSpeaking"
                    : kiraState === "thinking"
                      ? "thinking"
                      : micVolume > 0.02
                        ? "userSpeaking"
                        : "idle"
                }
                micVolume={micVolume}
                kiraVolume={isAudioPlaying ? playerVolume : 0}
                size="lg"
                enableBreathing={false}
              />
            )}
          </div>
        </div>
      </div>

      {/* ─── Bottom Area: Controls ─── */}
      <div
        className="fixed bottom-0 left-0 right-0 flex flex-col items-center gap-5 pb-9"
        style={{ zIndex: 50, position: "fixed" }}
      >
        {/* Status indicator + errors — sits between avatar and controls */}
        <div style={{ textAlign: "center", minHeight: 28, display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", margin: "24px 0 8px 0" }}>
          {/* Subtle reconnecting indicator — auto-dismisses when connection is restored */}
          {connectionStatus === "reconnecting" && !error && (
            <div className="mb-2 px-4 py-2 rounded-full" style={{
              background: "rgba(255,255,255,0.08)",
              color: "rgba(200,210,230,0.7)",
              fontSize: 13,
              display: "flex",
              alignItems: "center",
              gap: 8,
            }}>
              <span style={{
                width: 8,
                height: 8,
                borderRadius: "50%",
                background: "rgba(139,157,195,0.7)",
                display: "inline-block",
                animation: "pulse 1.5s ease-in-out infinite",
              }} />
              Reconnecting...
            </div>
          )}
          {error && error !== "limit_reached" && error !== "limit_reached_pro" && error !== "connection_lost" && error !== "heartbeat_timeout" && (
            <div className="mb-2 p-3 rounded relative" style={{
              background: "rgba(200,55,55,0.15)",
              border: "1px solid rgba(200,55,55,0.3)",
              color: "rgba(255,120,120,0.9)",
            }}>
              <span className="block sm:inline">{error}</span>
            </div>
          )}
          {error === "heartbeat_timeout" && (
            <div className="mb-2 p-4 rounded-xl relative text-center" style={{
              background: "rgba(0,0,0,0.85)",
              border: "1px solid rgba(107,125,179,0.2)",
              color: "#ffffff",
              minWidth: 280,
              padding: "20px 24px",
            }}>
              <p className="mb-3" style={{ fontSize: 16, fontWeight: 400, lineHeight: 1.5 }}>Connection timed out.</p>
              <button
                onClick={() => window.location.reload()}
                className="px-5 py-2.5 rounded-lg text-sm font-medium transition-colors"
                style={{
                  background: "rgba(139,157,195,0.25)",
                  border: "1px solid rgba(139,157,195,0.4)",
                  color: "#E2E8F0",
                  fontSize: 15,
                  cursor: "pointer",
                }}
              >
                Start New Conversation
              </button>
            </div>
          )}
          {error === "connection_lost" && (
            <div className="mb-2 p-4 rounded-xl relative text-center" style={{
              background: "rgba(0,0,0,0.85)",
              border: "1px solid rgba(107,125,179,0.2)",
              color: "#ffffff",
              minWidth: 280,
              padding: "20px 24px",
            }}>
              <p className="mb-3" style={{ fontSize: 16, fontWeight: 400, lineHeight: 1.5 }}>Connection lost. Tap to retry.</p>
              <button
                onClick={() => window.location.reload()}
                className="px-5 py-2.5 rounded-lg text-sm font-medium transition-colors"
                style={{
                  background: "rgba(139,157,195,0.25)",
                  border: "1px solid rgba(139,157,195,0.4)",
                  color: "#E2E8F0",
                  fontSize: 15,
                  cursor: "pointer",
                }}
              >
                Start New Conversation
              </button>
            </div>
          )}
        </div>
        {/* Voice Controls */}
        <div className="flex items-center gap-4 relative z-[1]">
        {/* Avatar/Orb Toggle */}
        <button
          onClick={() => {
            if (visualMode === "avatar") {
              // Switching to orb — reset retry count so user can try avatar again later
              live2dRetryCount.current = 0;
              setVisualMode("orb");
            } else {
              // Switching back to avatar — only allow if retries not exhausted
              if (live2dRetryCount.current < MAX_LIVE2D_RETRIES) {
                live2dRetryCount.current++;
                setLive2dFailed(false);
                setLive2dReady(false);
                // Delay remount to let iOS free the previous WebGL context
                setLive2dDismissed(true);
                setTimeout(() => {
                  setLive2dDismissed(false);
                  setVisualMode("avatar");
                }, 800);
              } else {
                debugLog("[UI] Live2D retry limit reached — staying on orb");
              }
            }
          }}
          className="flex items-center justify-center w-12 h-12 rounded-full border-none transition-all duration-200"
          style={{
            background: visualMode === "avatar" ? "rgba(255,255,255,0.12)" : "rgba(255,255,255,0.04)",
            color: visualMode === "avatar" ? "rgba(139,157,195,0.9)" : "rgba(139,157,195,0.45)",
          }}
          title={visualMode === "avatar" ? "Switch to Orb" : "Switch to Avatar"}
        >
          <Sparkles size={18} />
        </button>

        {/* Scene Toggle — animated background behind avatar */}
        {visualMode === "avatar" && (
          <button
            onClick={toggleScene}
            className="flex items-center justify-center w-12 h-12 rounded-full border-none transition-all duration-200"
            style={{
              background: isSceneActive ? "rgba(255,255,255,0.12)" : "rgba(255,255,255,0.04)",
              color: isSceneActive ? "rgba(139,157,195,0.9)" : "rgba(139,157,195,0.45)",
            }}
            title={isSceneActive ? "Hide scene" : "Show scene"}
          >
            <Paintbrush size={18} />
          </button>
        )}

        {/* Vision / Camera Button — only rendered after device detection */}
        {deviceDetected && !isMobile && (
          <button
            onClick={isScreenSharing ? stopScreenShare : startScreenShare}
            className="flex items-center justify-center w-12 h-12 rounded-full border-none transition-all duration-200"
            style={{
              background: isScreenSharing ? "rgba(255,255,255,0.12)" : "rgba(255,255,255,0.04)",
              color: isScreenSharing ? "rgba(139,157,195,0.9)" : "rgba(139,157,195,0.45)",
            }}
            title={isScreenSharing ? "Stop screen share" : "Start screen share"}
          >
            {isScreenSharing ? <Eye size={18} /> : <EyeOff size={18} />}
          </button>
        )}

        {/* Camera Button — mobile only, rendered after device detection */}
        {deviceDetected && isMobile && (
          <button
            onClick={() => isCameraActive ? stopCamera() : startCamera()}
            className="flex items-center justify-center w-12 h-12 rounded-full border-none transition-all duration-200"
            style={{
              background: isCameraActive ? "rgba(255,255,255,0.12)" : "rgba(255,255,255,0.04)",
              color: isCameraActive ? "rgba(139,157,195,0.9)" : "rgba(139,157,195,0.45)",
            }}
            title={isCameraActive ? "Stop camera" : "Start camera"}
          >
            <Camera size={18} />
          </button>
        )}

        {/* Mute Button */}
        <button
          onClick={toggleMute}
          className="flex items-center justify-center w-12 h-12 rounded-full border-none transition-all duration-200"
          style={{
            background: isMuted ? "rgba(255,255,255,0.12)" : "rgba(255,255,255,0.04)",
            color: isMuted ? "rgba(139,157,195,0.9)" : "rgba(139,157,195,0.45)",
          }}
        >
          {isMuted ? <MicOff size={18} /> : <Mic size={18} />}
        </button>

        {/* Clip Button — save last 30 seconds */}
        {clipBufferStarted.current && (
          <button
            onClick={handleClip}
            disabled={clipRecorder.isClipSaving}
            className="clip-btn flex items-center justify-center w-12 h-12 rounded-full border-none transition-all duration-200"
            style={{
              background: clipRecorder.isClipSaving
                ? "rgba(139,157,195,0.25)"
                : "rgba(255,255,255,0.04)",
              color: clipRecorder.isClipSaving
                ? "rgba(139,157,195,1)"
                : "rgba(139,157,195,0.45)",
              cursor: clipRecorder.isClipSaving ? "wait" : "pointer",
            }}
            title="Save last 30 seconds"
          >
            {clipRecorder.isClipSaving ? (
              <div className="clip-spinner" />
            ) : (
              <Scissors size={18} />
            )}
          </button>
        )}

        {/* End Call Button */}
        <button
          onClick={handleEndCall}
          className="flex items-center justify-center w-12 h-12 rounded-full border-none transition-all duration-200"
          style={{
            background: "rgba(200,55,55,0.75)",
            color: "rgba(255,255,255,0.9)",
          }}
          title="End Call"
        >
          <PhoneOff size={18} />
        </button>
        </div>
      </div>

      {/* Camera PIP Preview */}
      {isCameraActive && !pipMinimized && (
        <div
          onTouchStart={handlePipTouchStart}
          onTouchMove={handlePipTouchMove}
          onTouchEnd={handlePipTouchEnd}
          style={{
            position: "fixed",
            bottom: pipPosition.y,
            right: pipPosition.x,
            width: pipSize.w,
            height: pipSize.h,
            borderRadius: 12,
            overflow: "visible",
            border: "1px solid rgba(255, 255, 255, 0.15)",
            boxShadow: "0 4px 12px rgba(0, 0, 0, 0.3)",
            zIndex: 30,
            touchAction: "none",
          }}
        >
          <video
            ref={previewVideoRef}
            style={{
              width: "100%",
              height: "100%",
              objectFit: "cover",
              borderRadius: 12,
              transform: facingMode === "user" ? "scaleX(-1)" : "none",
            }}
            playsInline
            muted
            autoPlay
          />
          {/* Flip camera button */}
          <button
            onClick={() => flipCamera()}
            style={{
              position: "absolute",
              top: 4,
              right: 4,
              width: 24,
              height: 24,
              borderRadius: "50%",
              background: "rgba(0, 0, 0, 0.5)",
              border: "none",
              color: "white",
              fontSize: 12,
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              cursor: "pointer",
            }}
            title="Flip camera"
          >
            ↻
          </button>
          {/* Close / minimize button */}
          <button
            onClick={() => setPipMinimized(true)}
            style={{
              position: "absolute",
              top: 4,
              left: 4,
              width: 24,
              height: 24,
              borderRadius: "50%",
              background: "rgba(0, 0, 0, 0.5)",
              border: "none",
              color: "white",
              fontSize: 14,
              lineHeight: "24px",
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              cursor: "pointer",
            }}
            title="Minimize preview"
          >
            ×
          </button>
          {/* Resize handle — bottom-left corner */}
          <div
            onTouchStart={handleResizeStart}
            onTouchMove={handleResizeMove}
            onTouchEnd={handleResizeEnd}
            onPointerDown={handleResizeStart}
            onPointerMove={handleResizeMove}
            onPointerUp={handleResizeEnd}
            style={{
              position: "absolute",
              bottom: -2,
              left: -2,
              width: 24,
              height: 24,
              cursor: "nesw-resize",
              touchAction: "none",
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
            }}
          >
            <svg width="10" height="10" viewBox="0 0 10 10" style={{ opacity: 0.5 }}>
              <line x1="0" y1="10" x2="10" y2="0" stroke="white" strokeWidth="1.5" />
              <line x1="0" y1="6" x2="6" y2="0" stroke="white" strokeWidth="1.5" />
            </svg>
          </div>
        </div>
      )}

      {/* Minimized PIP — small restore bubble */}
      {isCameraActive && pipMinimized && (
        <button
          onClick={() => setPipMinimized(false)}
          style={{
            position: "fixed",
            bottom: 140,
            right: 16,
            width: 40,
            height: 40,
            borderRadius: "50%",
            background: "rgba(255, 255, 255, 0.08)",
            border: "1px solid rgba(255, 255, 255, 0.15)",
            boxShadow: "0 4px 12px rgba(0, 0, 0, 0.3)",
            zIndex: 30,
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            cursor: "pointer",
            color: "rgba(139, 157, 195, 0.7)",
          }}
          title="Restore camera preview"
        >
          <Camera size={18} />
        </button>
      )}

      {/* ─── Clip Share Modal ─── */}
      {clipRecorder.clipUrl && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center"
          style={{
            background: "rgba(0,0,0,0.7)",
            backdropFilter: "blur(16px)",
            animation: "paywallFadeIn 0.3s ease both",
          }}
          onClick={() => clipRecorder.setClipUrl(null)}
        >
          <div
            onClick={(e) => e.stopPropagation()}
            style={{
              background: "linear-gradient(135deg, rgba(20,25,35,0.97), rgba(13,17,23,0.99))",
              border: "1px solid rgba(107,125,179,0.15)",
              borderRadius: 20,
              padding: "24px",
              maxWidth: 360,
              width: "calc(100% - 48px)",
              fontFamily: "'DM Sans', sans-serif",
              boxShadow: "0 0 80px rgba(107,125,179,0.06)",
            }}
          >
            {/* Preview */}
            <div style={{
              borderRadius: 12,
              overflow: "hidden",
              marginBottom: 20,
              background: "#000",
              aspectRatio: "16/9",
            }}>
              <video
                src={clipRecorder.clipUrl}
                controls
                autoPlay
                muted
                playsInline
                style={{
                  width: "100%",
                  height: "100%",
                  objectFit: "contain",
                  display: "block",
                }}
              />
            </div>

            {/* Title */}
            <p style={{
              fontSize: 16,
              fontWeight: 500,
              color: "#E2E8F0",
              marginBottom: 16,
              textAlign: "center",
            }}>
              Clip saved ✂️
            </p>

            {/* Actions */}
            <div className="flex flex-col gap-3">
              {/* Share / Save to Photos (primary) */}
              <button
                onClick={() => clipRecorder.shareClip()}
                style={{
                  width: "100%",
                  padding: "13px 0",
                  borderRadius: 12,
                  border: "1px solid rgba(107,125,179,0.3)",
                  background: "linear-gradient(135deg, rgba(107,125,179,0.3), rgba(107,125,179,0.12))",
                  color: "#E2E8F0",
                  fontSize: 15,
                  fontWeight: 500,
                  cursor: "pointer",
                  fontFamily: "'DM Sans', sans-serif",
                  transition: "all 0.2s ease",
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "center",
                  gap: 8,
                }}
              >
                <Share2 size={16} />
                Share / Save to Photos
              </button>

              {/* Download (secondary) */}
              <button
                onClick={() => clipRecorder.downloadClip()}
                style={{
                  width: "100%",
                  padding: "12px 0",
                  borderRadius: 12,
                  border: "1px solid rgba(255,255,255,0.06)",
                  background: "rgba(255,255,255,0.04)",
                  color: "rgba(201,209,217,0.6)",
                  fontSize: 14,
                  fontWeight: 400,
                  cursor: "pointer",
                  fontFamily: "'DM Sans', sans-serif",
                  transition: "all 0.2s ease",
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "center",
                  gap: 8,
                }}
              >
                <Download size={15} />
                Download
              </button>

              {/* Discard */}
              <button
                onClick={() => clipRecorder.setClipUrl(null)}
                style={{
                  width: "100%",
                  padding: "10px 0",
                  background: "none",
                  border: "none",
                  color: "rgba(201,209,217,0.3)",
                  fontSize: 13,
                  fontWeight: 400,
                  cursor: "pointer",
                  fontFamily: "'DM Sans', sans-serif",
                  transition: "color 0.2s",
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "center",
                  gap: 6,
                }}
              >
                <X size={14} />
                Discard
              </button>

              {/* WebM tip for Chrome/Firefox users */}
              {!clipRecorder.clipMimeType.includes("mp4") && (
                <p style={{
                  fontSize: 11,
                  color: "rgba(201,209,217,0.25)",
                  textAlign: "center",
                  marginTop: 4,
                  lineHeight: 1.5,
                }}>
                  Tip: Upload directly to social media, or open in VLC
                </p>
              )}
            </div>
          </div>
        </div>
      )}

      {/* Rating Modal */}
      {showRatingModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center" style={{ background: "rgba(0,0,0,0.6)", backdropFilter: "blur(12px)" }}>
          <div style={{
            background: "#0D1117",
            border: "1px solid rgba(255,255,255,0.06)",
            borderRadius: 16,
            padding: "32px 28px",
            maxWidth: 360,
            width: "100%",
            fontFamily: "'DM Sans', sans-serif",
            textAlign: "center",
          }}>
            <h2 style={{
              fontSize: 20,
              fontFamily: "'Playfair Display', serif",
              fontWeight: 400,
              color: "#E2E8F0",
              marginBottom: 20,
              marginTop: 0,
            }}>
              Rate your conversation
            </h2>

            <div className="flex gap-2 justify-center mb-6">
              {[1, 2, 3, 4, 5].map((star) => (
                <button
                  key={star}
                  onMouseEnter={() => setHoverRating(star)}
                  onMouseLeave={() => setHoverRating(0)}
                  onClick={() => setRating(star)}
                  className="transition-transform hover:scale-110 focus:outline-none p-1"
                  style={{ background: "none", border: "none", cursor: "pointer" }}
                >
                  <Star
                    size={28}
                    className="transition-colors duration-150"
                    style={{
                      fill: star <= (hoverRating || rating) ? "#8B9DC3" : "transparent",
                      color: star <= (hoverRating || rating) ? "#8B9DC3" : "rgba(201,209,217,0.2)",
                    }}
                  />
                </button>
              ))}
            </div>

            <div className="flex flex-col w-full gap-3">
              <button
                onClick={handleRate}
                disabled={rating === 0}
                style={{
                  width: "100%",
                  padding: "12px 0",
                  borderRadius: 10,
                  border: "none",
                  background: rating > 0 ? "linear-gradient(135deg, rgba(107,125,179,0.3), rgba(107,125,179,0.15))" : "rgba(255,255,255,0.04)",
                  color: rating > 0 ? "#C9D1D9" : "rgba(201,209,217,0.3)",
                  fontSize: 14,
                  fontWeight: 500,
                  cursor: rating > 0 ? "pointer" : "not-allowed",
                  fontFamily: "'DM Sans', sans-serif",
                  transition: "all 0.2s",
                }}
              >
                Rate it
              </button>
              <button
                onClick={handleContinue}
                style={{
                  width: "100%",
                  padding: "12px 0",
                  background: "none",
                  border: "none",
                  color: "rgba(201,209,217,0.35)",
                  fontSize: 14,
                  fontWeight: 400,
                  cursor: "pointer",
                  fontFamily: "'DM Sans', sans-serif",
                  transition: "color 0.2s",
                }}
              >
                Continue
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Limit Reached — Paywall Overlay (Free users & Guests only, never Pro) */}
      {error === "limit_reached" && !isPro && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center"
          style={{
            background: "rgba(13,17,23,0.85)",
            backdropFilter: "blur(20px)",
            animation: "paywallFadeIn 0.6s ease both",
          }}
        >
          <div style={{
            background: "linear-gradient(135deg, rgba(20,25,35,0.95), rgba(13,17,23,0.98))",
            border: "1px solid rgba(107,125,179,0.12)",
            borderRadius: 20,
            padding: "40px 32px",
            maxWidth: 420,
            width: "100%",
            fontFamily: "'DM Sans', sans-serif",
            textAlign: "center",
            boxShadow: "0 0 80px rgba(107,125,179,0.06)",
          }}>
            {/* Ambient glow */}
            <div style={{
              width: 72,
              height: 72,
              borderRadius: 18,
              background: "linear-gradient(135deg, rgba(107,125,179,0.15), rgba(107,125,179,0.05))",
              border: "1px solid rgba(107,125,179,0.2)",
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              margin: "0 auto 24px",
            }}>
              <Clock size={28} style={{ color: "rgba(139,157,195,0.7)" }} />
            </div>

            {isGuest ? (
              <>
                <h2 style={{
                  fontSize: 24,
                  fontFamily: "'Playfair Display', serif",
                  fontWeight: 400,
                  color: "#E2E8F0",
                  marginBottom: 10,
                  marginTop: 0,
                }}>
                  This is the beginning of something
                </h2>
                <p style={{
                  fontSize: 15,
                  fontWeight: 300,
                  color: "rgba(201,209,217,0.5)",
                  lineHeight: 1.7,
                  marginBottom: 32,
                }}>
                  Create a free account and Kira keeps building on everything
                  you just talked about — and every conversation after.
                </p>
                <div className="flex flex-col w-full gap-3">
                  <button
                    onClick={handleSignUp}
                    style={{
                      width: "100%",
                      padding: "14px 0",
                      borderRadius: 12,
                      border: "1px solid rgba(107,125,179,0.25)",
                      background: "linear-gradient(135deg, rgba(107,125,179,0.25), rgba(107,125,179,0.1))",
                      color: "#C9D1D9",
                      fontSize: 15,
                      fontWeight: 500,
                      cursor: "pointer",
                      fontFamily: "'DM Sans', sans-serif",
                      transition: "all 0.3s ease",
                      boxShadow: "0 0 30px rgba(107,125,179,0.08)",
                    }}
                  >
                    Create free account
                  </button>
                  <a
                    href="/"
                    style={{
                      display: "block",
                      width: "100%",
                      padding: "12px 0",
                      color: "rgba(201,209,217,0.3)",
                      fontSize: 14,
                      fontWeight: 400,
                      textAlign: "center",
                      textDecoration: "none",
                      transition: "color 0.2s",
                    }}
                  >
                    I&apos;ll come back tomorrow
                  </a>
                </div>
              </>
            ) : (
              <>
                <h2 style={{
                  fontSize: 24,
                  fontFamily: "'Playfair Display', serif",
                  fontWeight: 400,
                  color: "#E2E8F0",
                  marginBottom: 10,
                  marginTop: 0,
                }}>
                  You&apos;ve used your 15 minutes
                </h2>
                <p style={{
                  fontSize: 15,
                  fontWeight: 300,
                  color: "rgba(201,209,217,0.5)",
                  lineHeight: 1.7,
                  marginBottom: 32,
                }}>
                  Upgrade to Pro for unlimited conversations,
                  priority responses, and persistent memory across sessions.
                </p>
                <div className="flex flex-col w-full gap-3">
                  <button
                    onClick={handleUpgrade}
                    style={{
                      width: "100%",
                      padding: "14px 0",
                      borderRadius: 12,
                      border: "1px solid rgba(107,125,179,0.25)",
                      background: "linear-gradient(135deg, rgba(107,125,179,0.25), rgba(107,125,179,0.1))",
                      color: "#C9D1D9",
                      fontSize: 15,
                      fontWeight: 500,
                      cursor: "pointer",
                      fontFamily: "'DM Sans', sans-serif",
                      transition: "all 0.3s ease",
                      boxShadow: "0 0 30px rgba(107,125,179,0.08)",
                    }}
                  >
                    Upgrade to Pro — $9.99/mo
                  </button>
                  <a
                    href="/"
                    style={{
                      display: "block",
                      width: "100%",
                      padding: "12px 0",
                      color: "rgba(201,209,217,0.3)",
                      fontSize: 14,
                      fontWeight: 400,
                      textAlign: "center",
                      textDecoration: "none",
                      transition: "color 0.2s",
                    }}
                  >
                    I&apos;ll come back tomorrow
                  </a>
                </div>
              </>
            )}
          </div>
        </div>
      )}

      {/* Pro Limit Reached — Warm Full-Screen Overlay (no upsell) */}
      {error === "limit_reached_pro" && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center"
          style={{
            background: "rgba(13,17,23,0.85)",
            backdropFilter: "blur(20px)",
            animation: "paywallFadeIn 0.6s ease both",
          }}
        >
          <div style={{
            background: "linear-gradient(135deg, rgba(20,25,35,0.95), rgba(13,17,23,0.98))",
            border: "1px solid rgba(107,125,179,0.12)",
            borderRadius: 20,
            padding: "40px 32px",
            maxWidth: 420,
            width: "100%",
            fontFamily: "'DM Sans', sans-serif",
            textAlign: "center",
            boxShadow: "0 0 80px rgba(107,125,179,0.06)",
          }}>
            <div style={{
              width: 72,
              height: 72,
              borderRadius: 18,
              background: "linear-gradient(135deg, rgba(107,125,179,0.15), rgba(107,125,179,0.05))",
              border: "1px solid rgba(107,125,179,0.2)",
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              margin: "0 auto 24px",
            }}>
              <Clock size={28} style={{ color: "rgba(139,157,195,0.7)" }} />
            </div>

            <h2 style={{
              fontSize: 24,
              fontFamily: "'Playfair Display', serif",
              fontWeight: 400,
              color: "#E2E8F0",
              marginBottom: 10,
              marginTop: 0,
            }}>
              You&apos;ve had quite the month
            </h2>
            <p style={{
              fontSize: 15,
              fontWeight: 300,
              color: "rgba(201,209,217,0.5)",
              lineHeight: 1.7,
              marginBottom: 8,
            }}>
              You&apos;ve reached your monthly conversation limit.
              Your conversations and memories are safe — Kira will be
              ready to pick up right where you left off.
            </p>
            <p style={{
              fontSize: 13,
              fontWeight: 300,
              color: "rgba(201,209,217,0.3)",
              marginBottom: 32,
            }}>
              Resets on the 1st of next month
            </p>
            <a
              href="/"
              style={{
                display: "block",
                width: "100%",
                padding: "14px 0",
                borderRadius: 12,
                border: "1px solid rgba(107,125,179,0.15)",
                background: "rgba(107,125,179,0.08)",
                color: "rgba(201,209,217,0.6)",
                fontSize: 15,
                fontWeight: 500,
                textAlign: "center",
                textDecoration: "none",
                fontFamily: "'DM Sans', sans-serif",
                transition: "all 0.3s ease",
              }}
            >
              Back to home
            </a>
          </div>
        </div>
      )}

      {/* Mobile Audio Unlock Overlay */}
      {isAudioBlocked && (
        <div className="fixed inset-0 z-50 flex items-center justify-center" style={{ background: "rgba(0,0,0,0.6)", backdropFilter: "blur(12px)" }}>
          <button
            onClick={resumeAudio}
            style={{
              display: "flex",
              flexDirection: "column",
              alignItems: "center",
              gap: 16,
              padding: "32px 40px",
              borderRadius: 16,
              background: "#0D1117",
              border: "1px solid rgba(255,255,255,0.06)",
              cursor: "pointer",
              fontFamily: "'DM Sans', sans-serif",
              transition: "transform 0.2s",
            }}
            onMouseEnter={(e) => { e.currentTarget.style.transform = "scale(1.02)"; }}
            onMouseLeave={(e) => { e.currentTarget.style.transform = "scale(1)"; }}
          >
            <div style={{
              width: 56,
              height: 56,
              borderRadius: 14,
              background: "linear-gradient(135deg, rgba(107,125,179,0.2), rgba(107,125,179,0.08))",
              border: "1px solid rgba(107,125,179,0.25)",
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
            }}>
              <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="rgba(139,157,195,0.7)" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
                <path d="M12 2a3 3 0 0 0-3 3v7a3 3 0 0 0 6 0V5a3 3 0 0 0-3-3Z" />
                <path d="M19 10v2a7 7 0 0 1-14 0v-2" />
                <line x1="12" y1="19" x2="12" y2="22" />
              </svg>
            </div>
            <span style={{
              fontSize: 16,
              fontWeight: 500,
              color: "#C9D1D9",
            }}>Tap to Start</span>
          </button>
        </div>
      )}
    </div>
  );
}
