"use client";

import React, { useEffect, useRef } from "react";

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
  /** Kira audio volume 0-1, drives orb + halo pulse when Kira speaks. */
  kiraVolume?: number;
  /** Size preset — sm (mobile), md (landing / hero), lg (chat page desktop). */
  size?: OrbSize;
  /** Whether to show the state-indicator label below the orb. */
  showLabel?: boolean;
  /** Enable idle breathing animation. true for landing page, false for chat page. */
  enableBreathing?: boolean;
}

// ─── Isolated sonar ring — React.memo walls off micVolume 60fps re-renders ──
const SonarRing = React.memo(({ kiraState, orbSize }: { kiraState: string; orbSize: number }) => {
  const ringRef = useRef<HTMLDivElement>(null);
  const hideTimeout = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    const isSpeaking = kiraState === 'kiraSpeaking';

    if (isSpeaking) {
      if (hideTimeout.current) {
        clearTimeout(hideTimeout.current);
        hideTimeout.current = null;
      }
      if (ringRef.current) {
        ringRef.current.style.visibility = 'visible';
      }
    } else {
      hideTimeout.current = setTimeout(() => {
        if (ringRef.current) {
          ringRef.current.style.visibility = 'hidden';
        }
      }, 200);
    }

    return () => {
      if (hideTimeout.current) clearTimeout(hideTimeout.current);
    };
  }, [kiraState]);

  return (
    <div
      ref={ringRef}
      className="sonar-ring"
      style={{
        position: 'absolute',
        width: orbSize,
        height: orbSize,
        borderRadius: '50%',
        border: '2.5px solid rgba(170, 190, 230, 0.6)',
        boxShadow: '0 0 10px rgba(170, 190, 230, 0.3)',
        visibility: 'hidden',
      }}
    />
  );
});

SonarRing.displayName = 'SonarRing';

// ─── Component ───────────────────────────────────────────────────────────────
export default function KiraOrb({
  state = "idle",
  micVolume = 0,
  kiraVolume = 0,
  size = "lg",
  showLabel = false,
  enableBreathing = true,
}: KiraOrbProps) {
  const orbRef = useRef<HTMLDivElement>(null);
  const haloRef = useRef<HTMLDivElement>(null);
  const animFrame = useRef<number>(0);

  const { orb: orbSize, glow: glowSize, container: containerSize } = SIZES[size];

  const isUserSpeaking = state === "userSpeaking" && micVolume > 0.02;
  const isKiraSpeaking = state === "kiraSpeaking";

  // ─── Refs so rAF closures always see latest values ───────────────────
  const micRef = useRef(micVolume);
  const kiraVolRef = useRef(kiraVolume);
  micRef.current = micVolume;
  kiraVolRef.current = kiraVolume;

  // ─── Orb scale: user speech OR Kira speech (rAF loop) ───────────────
  useEffect(() => {
    const orb = orbRef.current;
    if (!orb) return;

    if (isUserSpeaking) {
      orb.style.animation = "none";
      const tick = () => {
        const scale = 1 + Math.min(micRef.current, 1) * 0.15;
        orb.style.transition = "transform 0.05s ease-out";
        orb.style.transform = `scale(${scale})`;
        animFrame.current = requestAnimationFrame(tick);
      };
      tick();
      return () => cancelAnimationFrame(animFrame.current);
    } else if (isKiraSpeaking) {
      orb.style.animation = "none";
      const tick = () => {
        const scale = 1 + kiraVolRef.current * 0.08; // Subtle — half of user speech
        orb.style.transition = "transform 0.05s ease-out";
        orb.style.transform = `scale(${scale})`;
        animFrame.current = requestAnimationFrame(tick);
      };
      tick();
      return () => cancelAnimationFrame(animFrame.current);
    } else {
      orb.style.transition = "transform 0.5s ease-out";
      orb.style.transform = "scale(1)";
      if (enableBreathing) {
        const timer = setTimeout(() => {
          if (orbRef.current) {
            orbRef.current.style.transition = "";
            orbRef.current.style.transform = "";
            orbRef.current.style.animation = "kira-breathe 4.5s ease-in-out infinite";
          }
        }, 520);
        return () => clearTimeout(timer);
      } else {
        orb.style.animation = "none";
      }
    }
  }, [isUserSpeaking, isKiraSpeaking, enableBreathing]);

  // ─── Halo: pulsing glow ring driven by Kira audio amplitude ─────────
  useEffect(() => {
    const halo = haloRef.current;
    if (!halo) return;

    if (isKiraSpeaking) {
      halo.style.opacity = '1';
      let frame: number;
      const animate = () => {
        const vol = kiraVolRef.current;
        const haloScale = 1.05 + vol * 0.2;
        halo.style.transform = `scale(${haloScale})`;
        frame = requestAnimationFrame(animate);
      };
      animate();
      return () => cancelAnimationFrame(frame);
    } else {
      halo.style.opacity = '0';
      halo.style.transform = 'scale(1)';
    }
  }, [isKiraSpeaking]);

  return (
    <div className="relative flex flex-col items-center">
      <div
        className="relative flex items-center justify-center"
        style={{ width: containerSize, height: containerSize }}
      >
        {/* 1. Sonar ring — outermost, expands beyond everything */}
        <SonarRing kiraState={state} orbSize={orbSize} />

        {/* 2. Pulsing halo — audio-reactive glow ring around the orb */}
        <div
          ref={haloRef}
          className="absolute pointer-events-none"
          style={{
            width: orbSize,
            height: orbSize,
            borderRadius: '50%',
            background: `radial-gradient(circle, rgba(${ORB_RGB}, 0.15) 60%, transparent 100%)`,
            filter: 'blur(8px)',
            transform: 'scale(1)',
            opacity: 0,
            transition: 'opacity 0.3s ease',
          }}
        />

        {/* 3. Subtle ambient glow behind orb */}
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
