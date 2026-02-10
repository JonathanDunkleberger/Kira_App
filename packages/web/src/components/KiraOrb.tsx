"use client";

import { useEffect, useRef, useState } from "react";
import type { KiraState } from "@/hooks/useKiraSocket";

// ─── Orb color palette (matches KIRA_THEME accent family) ────────────────────
const ORB_COLOR_LIGHT = "#A3B8D8"; // lighter tint
const ORB_COLOR_BASE = "#6B7DB3";  // primary accent
const ORB_COLOR_DARK = "#4A5A8A";  // darker shade
const ORB_RGB = "107,125,179";     // base as RGB for rgba()

interface KiraOrbProps {
  kiraState: KiraState;
  micVolume: number;      // 0-1  (from useKiraSocket)
  speakerVolume: number;  // 0-1  (playerVolume from useKiraSocket)
  /** CSS px – defaults to 300 (container). Orb = 200px desktop, 150px mobile. */
  size?: number;
}

// ─── Component ───────────────────────────────────────────────────────────────
export default function KiraOrb({
  kiraState,
  micVolume,
  // speakerVolume is not used — Kira-speaking state uses sonar rings instead
}: KiraOrbProps) {
  const orbRef = useRef<HTMLDivElement>(null);
  const [rings, setRings] = useState<number[]>([]);
  const [isMobile, setIsMobile] = useState(false);

  // ─── Responsive sizing ──────────────────────────────────────────────
  useEffect(() => {
    const mq = window.matchMedia("(max-width: 640px)");
    setIsMobile(mq.matches);
    const handler = (e: MediaQueryListEvent) => setIsMobile(e.matches);
    mq.addEventListener("change", handler);
    return () => mq.removeEventListener("change", handler);
  }, []);

  const orbSize = isMobile ? 150 : 200;
  const outerRingSize = isMobile ? 195 : 260;
  const glowSize = isMobile ? 165 : 220;
  const highlightSize = isMobile ? 135 : 180;
  const containerSize = isMobile ? 225 : 300;

  const isKiraSpeaking = kiraState === "speaking";
  const isUserSpeaking = kiraState === "listening" && micVolume > 0.02;
  const isIdle = kiraState === "listening" && micVolume <= 0.02;
  const isThinking = kiraState === "thinking";

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
      {/* Sizing container — keeps layout consistent with old 300px canvas */}
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
            // Thinking state: slightly dimmer
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

      {/* State indicator */}
      <div
        className="mt-2 text-[11px] tracking-[0.2em] uppercase font-light transition-colors duration-500"
        style={{
          color: "rgba(139,157,195,0.35)",
          height: 16,
        }}
      >
        {kiraState === "listening"
          ? "Listening..."
          : kiraState === "thinking"
            ? "Thinking..."
            : ""}
      </div>
    </div>
  );
}
