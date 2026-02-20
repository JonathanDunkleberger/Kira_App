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
  /** Kira audio volume 0-1, drives shadow ring + sonar spawning when Kira speaks. */
  kiraVolume?: number;
  /** Size preset — sm (mobile), md (landing / hero), lg (chat page desktop). */
  size?: OrbSize;
  /** Whether to show the state-indicator label below the orb. */
  showLabel?: boolean;
  /** Enable idle breathing animation. true for landing page, false for chat page. */
  enableBreathing?: boolean;
}

// ─── Audio-driven ring: shadow ring + sonar spawning ─────────────────────────
interface AudioDrivenRingProps {
  isActive: boolean;
  volumeRef: React.RefObject<number>;
  orbSize: number;
}

const AudioDrivenRing: React.FC<AudioDrivenRingProps> = ({ isActive, volumeRef, orbSize }) => {
  const shadowRef = useRef<HTMLDivElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const animFrameRef = useRef<number>(0);
  const lastRingTime = useRef(0);
  const smoothedVolume = useRef(0);
  const sonarIntervalRef = useRef<ReturnType<typeof setInterval> | null>(null);

  useEffect(() => {
    if (!isActive) {
      // Reset when not speaking
      if (shadowRef.current) {
        shadowRef.current.style.transform = 'scale(1)';
        shadowRef.current.style.opacity = '0';
      }
      smoothedVolume.current = 0;
      cancelAnimationFrame(animFrameRef.current);
      // Stop sonar pulses
      if (sonarIntervalRef.current) {
        clearInterval(sonarIntervalRef.current);
        sonarIntervalRef.current = null;
      }
      return;
    }

    // Show shadow ring
    if (shadowRef.current) {
      shadowRef.current.style.opacity = '1';
    }

    // Start continuous sonar pulse: 2-3 staggered rings every 2s
    if (!sonarIntervalRef.current) {
      // Fire first pulse immediately
      spawnSonarPulse();
      sonarIntervalRef.current = setInterval(() => {
        spawnSonarPulse();
      }, 2200);
    }

    const animate = () => {
      const rawVol = volumeRef.current || 0;

      // Smooth the volume to avoid jitter (fast attack, moderate release)
      const attack = 0.4;
      const release = 0.12;
      if (rawVol > smoothedVolume.current) {
        smoothedVolume.current += (rawVol - smoothedVolume.current) * attack;
      } else {
        smoothedVolume.current += (rawVol - smoothedVolume.current) * release;
      }

      const vol = smoothedVolume.current;

      // Shadow ring: fully volume-driven — disappears completely during silence/pauses
      if (shadowRef.current) {
        const shadowScale = 1.05 + vol * 0.25;
        // Opacity ramps from 0→1 with volume; cuts to 0 below threshold so
        // mid-speech pauses look identical to end-of-turn silence.
        const shadowOpacity = vol < 0.03 ? 0 : Math.min(1, vol * 2.5);
        shadowRef.current.style.transform = `scale(${shadowScale})`;
        shadowRef.current.style.opacity = `${shadowOpacity}`;
        // Border gets slightly thicker on louder moments
        const borderWidth = 8 + vol * 8; // 8px to 16px
        shadowRef.current.style.borderWidth = `${borderWidth}px`;
      }

      // Spawn a sonar ring on vocal peaks, moderate gap
      const now = Date.now();
      if (vol > 0.35 && now - lastRingTime.current > 1200) {
        lastRingTime.current = now;
        spawnSonarRing();
      }

      animFrameRef.current = requestAnimationFrame(animate);
    };

    animate();
    return () => {
      cancelAnimationFrame(animFrameRef.current);
      if (sonarIntervalRef.current) {
        clearInterval(sonarIntervalRef.current);
        sonarIntervalRef.current = null;
      }
    };
  }, [isActive, orbSize]);

  /** Spawn 2-3 staggered sonar rings as a pulse burst */
  const spawnSonarPulse = () => {
    const ringCount = 2 + Math.round(Math.random()); // 2 or 3 rings
    for (let i = 0; i < ringCount; i++) {
      setTimeout(() => spawnSonarRing(), i * 300); // 300ms stagger
    }
  };

  const spawnSonarRing = () => {
    if (!containerRef.current) return;

    const ring = document.createElement('div');
    ring.style.cssText = `
      position: absolute;
      width: ${orbSize}px;
      height: ${orbSize}px;
      border-radius: 50%;
      border: 2px solid rgba(200, 160, 230, 0.4);
      box-shadow: 0 0 8px rgba(180, 140, 220, 0.25);
      animation: sonar-expand 1.8s ease-out forwards;
      pointer-events: none;
      top: 50%;
      left: 50%;
      margin-top: -${orbSize / 2}px;
      margin-left: -${orbSize / 2}px;
    `;

    containerRef.current.appendChild(ring);

    // Remove after animation completes
    setTimeout(() => {
      ring.remove();
    }, 1800);
  };

  return (
    <div
      ref={containerRef}
      style={{
        position: 'absolute',
        width: `${orbSize}px`,
        height: `${orbSize}px`,
        pointerEvents: 'none',
      }}
    >
      {/* Shadow ring — solid lighter band around the orb */}
      <div
        ref={shadowRef}
        style={{
          position: 'absolute',
          width: '100%',
          height: '100%',
          borderRadius: '50%',
          background: 'transparent',
          border: '12px solid rgba(140, 170, 210, 0.3)',
          boxSizing: 'border-box',
          transform: 'scale(1.05)',
          opacity: 0,
          transition: 'opacity 0.2s ease',
          pointerEvents: 'none',
        }}
      />
    </div>
  );
};

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
  const animFrame = useRef<number>(0);

  const { orb: orbSize, glow: glowSize, container: containerSize } = SIZES[size];

  const isUserSpeaking = state === "userSpeaking" && micVolume > 0.02;
  const isKiraSpeaking = state === "kiraSpeaking";

  // ─── Refs so rAF closures always see latest values ───────────────────
  const micRef = useRef(micVolume);
  const kiraVolumeRef = useRef(kiraVolume);
  micRef.current = micVolume;
  kiraVolumeRef.current = kiraVolume || 0;

  // ─── Orb scale: user speech (rAF loop), static during Kira speech ───
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
      // Orb is static during Kira speech — shadow ring handles the animation
      orb.style.animation = "none";
      orb.style.transition = "transform 0.3s ease-out";
      orb.style.transform = "scale(1)";
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

  return (
    <div className="relative flex flex-col items-center">
      <div
        className="relative flex items-center justify-center"
        style={{ width: containerSize, height: containerSize }}
      >
        {/* 1. Audio-driven ring — shadow ring + spawned sonar rings */}
        <AudioDrivenRing
          isActive={isKiraSpeaking}
          volumeRef={kiraVolumeRef}
          orbSize={orbSize}
        />

        {/* 2. Subtle ambient glow behind orb */}
        <div
          className="absolute rounded-full pointer-events-none"
          style={{
            width: glowSize,
            height: glowSize,
            background: `radial-gradient(circle, rgba(${ORB_RGB}, 0.10), transparent 70%)`,
          }}
        />

        {/* 3. Main orb — static during speech, breathing when idle */}
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
