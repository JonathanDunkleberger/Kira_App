"use client";

import { useEffect, useRef, useState } from "react";

// ─── Orb color palette ───────────────────────────────────────────────────────
// Almost-flat blue with minimal depth: center is barely lighter than edges.
const ORB_COLOR_CENTER = "#7B8FBF"; // very slightly lighter blue
const ORB_COLOR_EDGE   = "#6B7DB3"; // base accent (only ~12% darker)
const ORB_RGB = "107,125,179";      // base as RGB for rgba()

// ─── Size presets (lg reduced 25% from 200→150) ─────────────────────────────
const SIZES = {
  sm:  { orb:  90, glow: 100, container: 140 },
  md:  { orb: 130, glow: 145, container: 195 },
  lg:  { orb: 150, glow: 165, container: 225 },
} as const;

export type OrbSize = keyof typeof SIZES;

export interface KiraOrbProps {
  /** Visual state — defaults to "idle" (gentle breathing). */
  state?: "idle" | "userSpeaking" | "kiraSpeaking" | "thinking";
  /** Mic volume 0-1, only used when state is "userSpeaking". */
  micVolume?: number;
  /** Size preset — sm (mobile), md (landing / hero), lg (chat page desktop). */
  size?: OrbSize;
  /** Whether to show the state-indicator label below the orb. */
  showLabel?: boolean;
}

// ─── Component ───────────────────────────────────────────────────────────────
export default function KiraOrb({
  state = "idle",
  micVolume = 0,
  size = "lg",
  showLabel = false,
}: KiraOrbProps) {
  const orbRef = useRef<HTMLDivElement>(null);
  const [rings, setRings] = useState<number[]>([]);
  const lastRingTime = useRef(0);

  const { orb: orbSize, glow: glowSize, container: containerSize } = SIZES[size];

  const isKiraSpeaking = state === "kiraSpeaking";
  const isUserSpeaking = state === "userSpeaking" && micVolume > 0.02;
  const isIdle = state === "idle" || (state === "userSpeaking" && micVolume <= 0.02);
  const isThinking = state === "thinking";

  // ─── User-speaking: drive orb scale from micVolume via ref ───────────
  useEffect(() => {
    if (!orbRef.current) return;
    if (isUserSpeaking) {
      const scale = 1 + Math.min(micVolume, 1) * 0.08;
      orbRef.current.style.transform = `scale(${scale})`;
      orbRef.current.style.transition = "transform 0.1s ease-out";
      orbRef.current.style.animation = "none";
    } else if (isIdle || isThinking) {
      orbRef.current.style.transform = "";
      orbRef.current.style.transition = "";
      orbRef.current.style.animation = "kira-breathe 7s ease-in-out infinite";
    } else if (isKiraSpeaking) {
      orbRef.current.style.transform = "scale(1)";
      orbRef.current.style.transition = "transform 0.3s ease-out";
      orbRef.current.style.animation = "none";
    }
  }, [isUserSpeaking, isIdle, isThinking, isKiraSpeaking, micVolume]);

  // ─── Sonar rings: one when speech starts, then every 2.5s ───────────
  useEffect(() => {
    if (isKiraSpeaking) {
      // Spawn one ring immediately when speech starts
      setRings((prev) => [...prev.slice(-2), Date.now()]);
      lastRingTime.current = Date.now();

      // Then one more ring every 2.5s while still speaking
      const interval = setInterval(() => {
        const now = Date.now();
        if (now - lastRingTime.current >= 2500) {
          setRings((prev) => [...prev.slice(-2), Date.now()]);
          lastRingTime.current = now;
        }
      }, 2500);

      return () => clearInterval(interval);
    }
    // Don't clear rings immediately — let existing ones finish their animation
  }, [isKiraSpeaking]);

  // ─── Clean up finished rings (match 1.2s animation duration) ────────
  useEffect(() => {
    if (rings.length > 0) {
      const timeout = setTimeout(() => {
        setRings((prev) => prev.slice(1)); // remove oldest ring
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
              // Subtle highlight — barely-there top-left warmth
              `radial-gradient(circle at 42% 38%, rgba(255,255,255,0.08) 0%, transparent 50%)`,
              // Near-flat base gradient — only ~12% darker at edges
              `radial-gradient(circle at 50% 50%, ${ORB_COLOR_CENTER} 0%, ${ORB_COLOR_EDGE} 100%)`,
            ].join(", "),
            boxShadow: `0 4px 24px rgba(${ORB_RGB}, 0.20)`,
            animation: "kira-breathe 7s ease-in-out infinite",
            willChange: "transform",
            filter: isThinking ? "brightness(0.85) saturate(0.9)" : "brightness(1)",
            transition: "filter 0.5s ease",
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
