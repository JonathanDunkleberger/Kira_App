"use client";

import { useEffect, useRef, useState } from "react";

// ─── Orb color palette ───────────────────────────────────────────────────────
const ORB_COLOR_CENTER = "#7B8FBF";
const ORB_COLOR_EDGE   = "#6B7DB3";
const ORB_RGB = "107,125,179";

// ─── Size presets ────────────────────────────────────────────────────────────
const SIZES = {
  sm:  { orb:  90, glow: 100, container: 140 },
  md:  { orb: 130, glow: 145, container: 195 },
  lg:  { orb: 150, glow: 165, container: 225 },
} as const;

export type OrbSize = keyof typeof SIZES;

export interface KiraOrbProps {
  /** Visual state — defaults to "idle" (gentle breathing). */
  state?: "idle" | "userSpeaking" | "kiraSpeaking" | "thinking";
  /** Mic volume 0-1, drives orb pulse when user speaks. */
  micVolume?: number;
  /** Playback volume 0-1, drives orb pulse when Kira speaks. */
  playerVolume?: number;
  /** Size preset — sm (mobile), md (landing / hero), lg (chat page desktop). */
  size?: OrbSize;
  /** Whether to show the state-indicator label below the orb. */
  showLabel?: boolean;
  /** Enable idle breathing animation. true for landing page, false for chat page. */
  enableBreathing?: boolean;
}

// ─── Component ───────────────────────────────────────────────────────────────
export default function KiraOrb({
  state = "idle",
  micVolume = 0,
  playerVolume = 0,
  size = "lg",
  showLabel = false,
  enableBreathing = true,
}: KiraOrbProps) {
  const orbRef = useRef<HTMLDivElement>(null);
  const [rings, setRings] = useState<number[]>([]);
  const lastRingTime = useRef(0);
  const animFrame = useRef<number>(0);

  const { orb: orbSize, glow: glowSize, container: containerSize } = SIZES[size];

  const isKiraSpeaking = state === "kiraSpeaking";
  const isUserSpeaking = state === "userSpeaking" && micVolume > 0.02;
  const isActive = isUserSpeaking || isKiraSpeaking;

  // ─── Audio-driven pulsing (rAF loop for both directions) ─────────────
  // Refs so the rAF closure always sees latest values without re-starting
  const micRef = useRef(micVolume);
  const playerRef = useRef(playerVolume);
  const kiraSpeakingRef = useRef(isKiraSpeaking);
  const userSpeakingRef = useRef(isUserSpeaking);
  micRef.current = micVolume;
  playerRef.current = playerVolume;
  kiraSpeakingRef.current = isKiraSpeaking;
  userSpeakingRef.current = isUserSpeaking;

  useEffect(() => {
    const orb = orbRef.current;
    if (!orb) return;

    if (isActive) {
      // Kill CSS breathing — JS drives transform now
      orb.style.animation = "none";

      const tick = () => {
        let scale = 1;
        if (kiraSpeakingRef.current) {
          // Kira speaking — pulse with TTS playback amplitude
          scale = 1 + Math.min(playerRef.current, 1) * 0.15;
        } else if (userSpeakingRef.current) {
          // User speaking — pulse with mic amplitude
          scale = 1 + Math.min(micRef.current, 1) * 0.15;
        }
        orb.style.transition = "transform 0.05s ease-out";
        orb.style.transform = `scale(${scale})`;
        animFrame.current = requestAnimationFrame(tick);
      };
      tick();

      return () => cancelAnimationFrame(animFrame.current);
    } else {
      // Ease back to idle
      orb.style.transition = "transform 0.5s ease-out";
      orb.style.transform = "scale(1)";
      if (enableBreathing) {
        // After the ease-back finishes, re-enable CSS breathing (landing page)
        const timer = setTimeout(() => {
          if (orbRef.current) {
            orbRef.current.style.transition = "";
            orbRef.current.style.transform = "";
            orbRef.current.style.animation = "kira-breathe 4.5s ease-in-out infinite";
          }
        }, 520);
        return () => clearTimeout(timer);
      } else {
        // Chat page: stay perfectly still at scale(1), no breathing
        orb.style.animation = "none";
      }
    }
  }, [isActive, enableBreathing]);

  // ─── Sonar rings: one when speech starts, then every 2.5s ───────────
  useEffect(() => {
    if (isKiraSpeaking) {
      setRings((prev) => [...prev.slice(-2), Date.now()]);
      lastRingTime.current = Date.now();

      const interval = setInterval(() => {
        const now = Date.now();
        if (now - lastRingTime.current >= 2500) {
          setRings((prev) => [...prev.slice(-2), Date.now()]);
          lastRingTime.current = now;
        }
      }, 2500);

      return () => clearInterval(interval);
    }
  }, [isKiraSpeaking]);

  // ─── Clean up finished rings (match 1.2s animation duration) ────────
  useEffect(() => {
    if (rings.length > 0) {
      const timeout = setTimeout(() => {
        setRings((prev) => prev.slice(1));
      }, 1200);
      return () => clearTimeout(timeout);
    }
  }, [rings]);

  return (
    <div className="relative flex flex-col items-center">
      <div
        className="relative flex items-center justify-center"
        style={{ width: containerSize, height: containerSize }}
      >
        {/* Sonar rings — only when Kira speaks */}
        {rings.map((id) => (
          <div
            key={id}
            className="absolute rounded-full pointer-events-none"
            style={{
              width: orbSize,
              height: orbSize,
              border: `1.5px solid rgba(${ORB_RGB}, 0.25)`,
              animation: "kira-sonar 1.2s ease-out forwards",
            }}
          />
        ))}

        {/* Subtle ambient glow behind orb */}
        <div
          className="absolute rounded-full pointer-events-none"
          style={{
            width: glowSize,
            height: glowSize,
            background: `radial-gradient(circle, rgba(${ORB_RGB}, 0.10), transparent 70%)`,
          }}
        />

        {/* ─── Main orb ─── */}
        <div
          ref={orbRef}
          className="rounded-full"
          style={{
            width: orbSize,
            height: orbSize,
            background: [
              `radial-gradient(circle at 42% 38%, rgba(255,255,255,0.08) 0%, transparent 50%)`,
              `radial-gradient(circle at 50% 50%, ${ORB_COLOR_CENTER} 0%, ${ORB_COLOR_EDGE} 100%)`,
            ].join(", "),
            boxShadow: `0 4px 24px rgba(${ORB_RGB}, 0.20)`,
            animation: enableBreathing ? "kira-breathe 4.5s ease-in-out infinite" : "none",
            willChange: "transform",
          }}
        />
      </div>

      {/* State indicator — only shown when showLabel is true */}
      {showLabel && (
        <div
          className="mt-2 text-[11px] tracking-[0.2em] uppercase font-light transition-colors duration-500"
          style={{
            color: "rgba(139,157,195,0.35)",
            height: 16,
          }}
        >
          {state === "idle" || state === "userSpeaking"
            ? "Listening..."
            : state === "thinking"
              ? "Thinking..."
              : ""}
        </div>
      )}
    </div>
  );
}
