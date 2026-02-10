"use client";

import { useEffect, useRef, useState } from "react";

// ─── Orb color palette (matches KIRA_THEME accent family) ────────────────────
const ORB_COLOR_LIGHT = "#A3B8D8"; // lighter tint
const ORB_COLOR_BASE = "#6B7DB3";  // primary accent
const ORB_COLOR_DARK = "#4A5A8A";  // darker shade
const ORB_RGB = "107,125,179";     // base as RGB for rgba()

// ─── Size presets ────────────────────────────────────────────────────────────
const SIZES = {
  sm:  { orb: 120, ring: 156, glow: 132, highlight: 108, container: 180 },
  md:  { orb: 150, ring: 195, glow: 165, highlight: 135, container: 225 },
  lg:  { orb: 200, ring: 260, glow: 220, highlight: 180, container: 300 },
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

  const { orb: orbSize, ring: outerRingSize, glow: glowSize, highlight: highlightSize, container: containerSize } = SIZES[size];

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
      orbRef.current.style.animation = "kira-breathe 4s ease-in-out infinite";
    } else if (isKiraSpeaking) {
      orbRef.current.style.transform = "scale(1)";
      orbRef.current.style.transition = "transform 0.3s ease-out";
      orbRef.current.style.animation = "none";
    }
  }, [isUserSpeaking, isIdle, isThinking, isKiraSpeaking, micVolume]);

  // ─── Sonar rings while Kira speaks ──────────────────────────────────
  useEffect(() => {
    if (isKiraSpeaking) {
      const interval = setInterval(() => {
        setRings((prev) => [...prev.slice(-3), Date.now()]); // max 4 rings
      }, 800);
      return () => clearInterval(interval);
    } else {
      setRings([]);
    }
  }, [isKiraSpeaking]);

  // Clean up expired rings (after animation ends — 2s)
  useEffect(() => {
    if (rings.length === 0) return;
    const timeout = setTimeout(() => {
      setRings((prev) => prev.filter((id) => Date.now() - id < 2000));
    }, 2100);
    return () => clearTimeout(timeout);
  }, [rings]);

  return (
    <div className="relative flex flex-col items-center">
      <div
        className="relative flex items-center justify-center"
        style={{ width: containerSize, height: containerSize }}
      >
        {/* Outer decorative ring — always visible */}
        <div
          className="absolute rounded-full"
          style={{
            width: outerRingSize,
            height: outerRingSize,
            border: `1px solid rgba(${ORB_RGB}, 0.12)`,
          }}
        />

        {/* Sonar rings — only when Kira speaks */}
        {rings.map((id) => (
          <div
            key={id}
            className="absolute rounded-full pointer-events-none"
            style={{
              width: orbSize,
              height: orbSize,
              border: `1.5px solid rgba(${ORB_RGB}, 0.3)`,
              animation: "kira-sonar 2s ease-out forwards",
            }}
          />
        ))}

        {/* Inner glow / ambient shadow behind orb */}
        <div
          className="absolute rounded-full pointer-events-none"
          style={{
            width: glowSize,
            height: glowSize,
            background: `radial-gradient(circle, rgba(${ORB_RGB}, 0.15), transparent 70%)`,
          }}
        />

        {/* ─── Main orb ─── */}
        <div
          ref={orbRef}
          className="rounded-full"
          style={{
            width: orbSize,
            height: orbSize,
            background: `radial-gradient(circle at 38% 38%, ${ORB_COLOR_LIGHT}, ${ORB_COLOR_BASE} 60%, ${ORB_COLOR_DARK})`,
            boxShadow: `0 4px 30px rgba(${ORB_RGB}, 0.25)`,
            animation: "kira-breathe 4s ease-in-out infinite",
            willChange: "transform",
            filter: isThinking ? "brightness(0.85) saturate(0.9)" : "brightness(1)",
            transition: "filter 0.5s ease",
          }}
        />

        {/* Specular highlight — gives soft 3D depth */}
        <div
          className="absolute rounded-full pointer-events-none"
          style={{
            width: highlightSize,
            height: highlightSize,
            background:
              "radial-gradient(circle at 32% 32%, rgba(255,255,255,0.22), transparent 60%)",
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
