"use client";

import { useAuth, useClerk } from "@clerk/nextjs";
import { useEffect, useRef, useState } from "react";
import { useKiraSocket } from "@/hooks/useKiraSocket";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { PhoneOff, Star, User, Mic, MicOff, Eye, EyeOff, Clock, Sparkles } from "lucide-react";
import ProfileModal from "@/components/ProfileModal";
import KiraOrb from "@/components/KiraOrb";
import { getOrCreateGuestId } from "@/lib/guestId";
import { getVoicePreference, setVoicePreference, VoicePreference } from "@/lib/voicePreference";
import { KiraLogo } from "@/components/KiraLogo";
import dynamic from "next/dynamic";

const Live2DAvatar = dynamic(() => import("@/components/Live2DAvatar"), { ssr: false });
const XOLoader = dynamic(() => import("@/components/XOLoader"), { ssr: false });

export default function ChatClient() {
  const router = useRouter();
  const { getToken, userId } = useAuth();
  const { openSignIn } = useClerk();
  const [token, setToken] = useState<string | null>(null);
  const [showRatingModal, setShowRatingModal] = useState(false);
  const hasShownRating = useRef(false); // Prevent rating dialog from showing twice
  const [showProfileModal, setShowProfileModal] = useState(false);
  const [rating, setRating] = useState(0);
  const [hoverRating, setHoverRating] = useState(0);
  const [guestId, setGuestId] = useState("");
  const [voicePreference, setVoicePref] = useState<VoicePreference>("anime");
  const [visualMode, setVisualMode] = useState<"avatar" | "orb">("avatar");
  const [live2dReady, setLive2dReady] = useState(false);
  const [live2dFailed, setLive2dFailed] = useState(false);
  const [isMobile, setIsMobile] = useState(false);

  useEffect(() => {
    setIsMobile(/iPhone|iPad|iPod|Android/i.test(navigator.userAgent));
  }, []);

  // If Live2D fails to load (e.g. mobile GPU limits), auto-switch to orb
  useEffect(() => {
    if (live2dFailed && visualMode === "avatar") {
      setVisualMode("orb");
      console.log("[UI] Live2D failed — falling back to orb mode");
    }
  }, [live2dFailed, visualMode]);

  // Load guest ID, voice preference, and chat toggle from localStorage
  useEffect(() => {
    if (!userId) {
      setGuestId(getOrCreateGuestId());
    }
    setVoicePref(getVoicePreference());
  }, [userId]);

  const { 
    connect, 
    disconnect,
    startConversation,
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
    isPro,
    remainingSeconds,
    isAudioPlaying,
    playerVolume,
    playbackAnalyserNode
  } = useKiraSocket(
    token || "",
    guestId,
    voicePreference
  );

  // Start conversation once both WebSocket is connected and Live2D model is ready
  // (or immediately if in orb mode — no model to wait for)
  const hasStartedConversation = useRef(false);
  useEffect(() => {
    if (hasStartedConversation.current) return;
    if (socketState !== "connected") return;
    if (visualMode === "avatar" && !live2dReady) return;
    hasStartedConversation.current = true;
    console.log("[Chat] Model ready + WS connected \u2014 starting conversation");
    startConversation();
  }, [socketState, live2dReady, visualMode, startConversation]);

  // 1. Get Clerk auth token
  useEffect(() => {
    if (userId) {
      getToken().then(setToken);
    }
  }, [getToken, userId]);

  // Disconnect only on unmount
  useEffect(() => {
    return () => {
      disconnect();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // --- UI Logic ---

  const handleEndCall = () => {
    disconnect();
    if (!hasShownRating.current) {
      hasShownRating.current = true;
      setShowRatingModal(true);
    }
  };

  const handleRate = () => {
    // TODO: Save rating to backend
    console.log("User rated conversation:", rating);
    setShowRatingModal(false);
    router.push("/");
  };

  const handleContinue = () => {
    setShowRatingModal(false);
    router.push("/");
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
          onClick={() => connect()}
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
    <div style={{ background: "#0D1117", fontFamily: "'DM Sans', -apple-system, BlinkMacSystemFont, sans-serif" }} className="flex flex-col items-center justify-center w-full h-screen">
      {/* Header */}
      <div className="absolute top-0 left-0 right-0 p-6 flex justify-between items-center z-20">
        <Link href="/">
          <span className="font-medium text-lg flex items-center gap-2" style={{ color: "#C9D1D9" }}>
            <KiraLogo size={24} id="chatXO" />
            Kira
          </span>
        </Link>
        
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
      <div className="flex-grow relative w-full max-w-4xl mx-auto">
        {/* Visual — absolutely centered */}
        <div className="absolute inset-0 flex items-center justify-center pointer-events-none" style={{ paddingBottom: 100 }}>
          <div className="pointer-events-auto" style={{ width: visualMode === "avatar" ? "100%" : undefined, height: visualMode === "avatar" ? "100%" : undefined, position: visualMode === "avatar" ? "relative" : undefined }}>
            {visualMode === "avatar" ? (
              <>
                {!live2dReady && <XOLoader />}
                <Live2DAvatar
                  isSpeaking={isAudioPlaying}
                  analyserNode={playbackAnalyserNode}
                  emotion={null}
                  onModelReady={() => setLive2dReady(true)}
                  onLoadError={() => setLive2dFailed(true)}
                />
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
                showLabel
                enableBreathing={false}
              />
            )}
          </div>
        </div>

        {/* Speaking / Listening indicator */}
        <div
          className="absolute"
          style={{
            bottom: 140,
            left: "50%",
            transform: "translateX(-50%)",
            textAlign: "center",
          }}
        >
          {error && error !== "limit_reached" && error !== "limit_reached_pro" && (
            <div className="mb-4 p-3 rounded relative" style={{
              background: "rgba(200,55,55,0.15)",
              border: "1px solid rgba(200,55,55,0.3)",
              color: "rgba(255,120,120,0.9)",
            }}>
              <span className="block sm:inline">{error}</span>
            </div>
          )}
          {socketState === "connected" && (
            <p
              style={{
                fontSize: 13,
                fontWeight: 300,
                letterSpacing: "0.08em",
                color: isAudioPlaying
                  ? "rgba(139,157,195,0.55)"
                  : kiraState === "thinking"
                    ? "rgba(139,157,195,0.35)"
                    : "rgba(201,209,217,0.3)",
                fontFamily: "'DM Sans', sans-serif",
                margin: 0,
                transition: "color 0.4s ease",
              }}
            >
              {isAudioPlaying ? "speaking" : kiraState === "thinking" ? "thinking" : "listening"}
            </p>
          )}
        </div>
      </div>

      {/* ─── Bottom Area: Controls ─── */}
      <div
        className="fixed bottom-0 left-0 right-0 flex flex-col items-center gap-5 pb-9 z-10"
      >
        {/* Voice Controls */}
        <div className="flex items-center gap-4 relative z-[1]">
        {/* Avatar/Orb Toggle */}
        <button
          onClick={() => setVisualMode(prev => prev === "avatar" ? "orb" : "avatar")}
          className="flex items-center justify-center w-12 h-12 rounded-full border-none transition-all duration-200"
          style={{
            background: visualMode === "avatar" ? "rgba(255,255,255,0.12)" : "rgba(255,255,255,0.04)",
            color: visualMode === "avatar" ? "rgba(139,157,195,0.9)" : "rgba(139,157,195,0.45)",
          }}
          title={visualMode === "avatar" ? "Switch to Orb" : "Switch to Avatar"}
        >
          <Sparkles size={18} />
        </button>

        {/* Vision Button — desktop only (getDisplayMedia not supported on mobile) */}
        {!isMobile && (
          <button
            onClick={isScreenSharing ? stopScreenShare : startScreenShare}
            className="flex items-center justify-center w-12 h-12 rounded-full border-none transition-all duration-200"
            style={{
              background: isScreenSharing ? "rgba(255,255,255,0.12)" : "rgba(255,255,255,0.04)",
              color: isScreenSharing ? "rgba(139,157,195,0.9)" : "rgba(139,157,195,0.45)",
            }}
          >
            {isScreenSharing ? <Eye size={18} /> : <EyeOff size={18} />}
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
                  <Link
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
                  </Link>
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
                  <Link
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
                  </Link>
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
            <Link
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
            </Link>
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
