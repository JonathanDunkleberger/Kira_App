"use client";

import { useEffect, useRef, useCallback } from "react";
import type { KiraState } from "@/hooks/useKiraSocket";

// ─── Sentiment color palettes ────────────────────────────────────────────────
// Each sentiment has 4 colors (used as [base-dark, mid, highlight, edge]) + a glow
const SENTIMENTS: Record<
  string,
  { colors: [string, string, string, string]; glow: string }
> = {
  neutral: {
    colors: ["#4A5A8A", "#6B7DB3", "#8B9DC3", "#5A6A9A"],
    glow: "rgba(107,125,179,0.15)",
  },
  warm: {
    colors: ["#8A7030", "#C4A04A", "#E8C86A", "#A08838"],
    glow: "rgba(196,160,74,0.18)",
  },
  cool: {
    colors: ["#2A5A6A", "#4A8A9A", "#6AAABA", "#3A7080"],
    glow: "rgba(90,143,160,0.15)",
  },
  tender: {
    colors: ["#6A4A7A", "#9B7AAA", "#BB9ACA", "#7A5A8A"],
    glow: "rgba(155,122,170,0.15)",
  },
  playful: {
    colors: ["#7A6030", "#B08A5A", "#D0AA7A", "#907040"],
    glow: "rgba(176,138,90,0.15)",
  },
};

export type Sentiment = keyof typeof SENTIMENTS;

interface KiraOrbProps {
  kiraState: KiraState;
  micVolume: number; // 0-1  (from useKiraSocket)
  speakerVolume: number; // 0-1  (playerVolume from useKiraSocket)
  sentiment?: Sentiment;
  /** CSS px – defaults to 300 */
  size?: number;
}

// ─── Helpers ─────────────────────────────────────────────────────────────────
type RGB = [number, number, number];

function hexToRgb(hex: string): RGB {
  return [
    parseInt(hex.slice(1, 3), 16),
    parseInt(hex.slice(3, 5), 16),
    parseInt(hex.slice(5, 7), 16),
  ];
}

const lerp = (a: number, b: number, t: number) => a + (b - a) * t;

// ─── Component ───────────────────────────────────────────────────────────────
export default function KiraOrb({
  kiraState,
  micVolume,
  speakerVolume,
  sentiment = "neutral",
  size = 300,
}: KiraOrbProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const animRef = useRef<number>(0);
  const timeRef = useRef(0);
  const volumeRef = useRef(0);
  const stateRef = useRef<KiraState>("listening");

  // 4 colours, each as [r,g,b], smoothly interpolated every frame
  const currentColorsRef = useRef<RGB[]>(
    SENTIMENTS.neutral.colors.map(hexToRgb)
  );
  const targetColorsRef = useRef<RGB[]>(
    SENTIMENTS.neutral.colors.map(hexToRgb)
  );

  // Keep refs in sync (synchronous — no React batching delay)
  const micRef = useRef(micVolume);
  micRef.current = micVolume;
  const spkRef = useRef(speakerVolume);
  spkRef.current = speakerVolume;
  stateRef.current = kiraState;

  // Update target colors on sentiment change
  useEffect(() => {
    targetColorsRef.current = SENTIMENTS[sentiment].colors.map(hexToRgb);
  }, [sentiment]);

  // ─── Render loop (gradient-based, no pixel field) ───────────────────────
  const render = useCallback(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    timeRef.current += 0.016;
    const t = timeRef.current;

    // Read live values from refs
    const state = stateRef.current;
    const mic = micRef.current;
    const spk = spkRef.current;

    // Smooth volume
    let targetVol = 0;
    if (state === "listening") targetVol = mic;
    else if (state === "speaking") targetVol = spk;
    else targetVol = 0; // thinking
    volumeRef.current = lerp(volumeRef.current, targetVol, 0.04);
    const vol = volumeRef.current;

    // Smooth color transitions (per-channel lerp)
    const cc = currentColorsRef.current;
    const tc = targetColorsRef.current;
    for (let i = 0; i < 4; i++) {
      for (let j = 0; j < 3; j++) {
        cc[i][j] = lerp(cc[i][j], tc[i][j], 0.008);
      }
    }

    // ── State behaviours ──
    let breatheScale = 1;
    let internalSpeed = 1;
    let glowIntensity = 0.3;

    if (state === "thinking") {
      breatheScale = 0.97 + Math.sin(t * 0.8) * 0.03;
      internalSpeed = 0.12;
      glowIntensity = 0.15 + Math.sin(t * 0.8) * 0.08;
    } else if (state === "speaking") {
      breatheScale = 1.0 + vol * 0.1;
      internalSpeed = 0.2 + vol * 0.4;
      glowIntensity = 0.3 + vol * 0.25;
    } else {
      // listening
      breatheScale = 0.98 + Math.sin(t * 1.2) * 0.02 + vol * 0.06;
      internalSpeed = 0.15 + vol * 0.3;
      glowIntensity = 0.2 + vol * 0.15;
    }

    const s = size; // logical size
    const cx = s / 2;
    const cy = s / 2;
    const baseRadius = s * 0.317; // ~95px at size 300
    const radius = baseRadius * breatheScale;

    ctx.clearRect(0, 0, s, s);

    // ── Outer glow ──
    const glowGrad = ctx.createRadialGradient(
      cx, cy, radius * 0.7,
      cx, cy, radius * 2.0
    );
    const gc = cc[1];
    glowGrad.addColorStop(0, `rgba(${gc[0]},${gc[1]},${gc[2]},${glowIntensity * 0.1})`);
    glowGrad.addColorStop(0.4, `rgba(${gc[0]},${gc[1]},${gc[2]},${glowIntensity * 0.03})`);
    glowGrad.addColorStop(1, "transparent");
    ctx.fillStyle = glowGrad;
    ctx.fillRect(0, 0, s, s);

    // ── Clipping circle ──
    ctx.save();
    ctx.beginPath();
    ctx.arc(cx, cy, radius, 0, Math.PI * 2);
    ctx.clip();

    // ── Base fill — smooth radial ──
    const baseFill = ctx.createRadialGradient(cx - radius * 0.15, cy - radius * 0.15, 0, cx, cy, radius);
    baseFill.addColorStop(0, `rgb(${cc[0][0]},${cc[0][1]},${cc[0][2]})`);
    baseFill.addColorStop(0.7, `rgb(${Math.round((cc[0][0]+cc[3][0])/2)},${Math.round((cc[0][1]+cc[3][1])/2)},${Math.round((cc[0][2]+cc[3][2])/2)})`);
    baseFill.addColorStop(1, `rgb(${cc[3][0]},${cc[3][1]},${cc[3][2]})`);
    ctx.fillStyle = baseFill;
    ctx.fillRect(0, 0, s, s);

    // ── Slow internal flow — drifting light spots ──
    const spots = [
      { phase: 0, speed: 0.08, orbitR: 30, sz: 75, colorIdx: 1, yMult: 0.7 },
      { phase: 2.4, speed: 0.06, orbitR: 35, sz: 65, colorIdx: 2, yMult: 0.9 },
      { phase: 4.8, speed: 0.1, orbitR: 25, sz: 85, colorIdx: 1, yMult: 0.6 },
      { phase: 1.2, speed: 0.07, orbitR: 40, sz: 55, colorIdx: 2, yMult: 0.8 },
      { phase: 3.6, speed: 0.05, orbitR: 20, sz: 70, colorIdx: 1, yMult: 1.0 },
    ];

    for (const spot of spots) {
      const sp = spot.phase + t * spot.speed * internalSpeed;
      const sx = cx + Math.cos(sp) * spot.orbitR * (1 + vol * 0.15);
      const sy = cy + Math.sin(sp * spot.yMult) * spot.orbitR * (1 + vol * 0.15);
      const sr = spot.sz * (1 + vol * 0.12);

      const sg = ctx.createRadialGradient(sx, sy, 0, sx, sy, sr);
      const sc = cc[spot.colorIdx];
      sg.addColorStop(0, `rgba(${sc[0]},${sc[1]},${sc[2]},0.45)`);
      sg.addColorStop(0.4, `rgba(${sc[0]},${sc[1]},${sc[2]},0.15)`);
      sg.addColorStop(0.7, `rgba(${sc[0]},${sc[1]},${sc[2]},0.04)`);
      sg.addColorStop(1, `rgba(${sc[0]},${sc[1]},${sc[2]},0)`);

      ctx.globalCompositeOperation = "screen";
      ctx.fillStyle = sg;
      ctx.fillRect(0, 0, s, s);
    }

    // ── Specular highlight — very subtle ──
    ctx.globalCompositeOperation = "screen";
    const hlX = cx - radius * 0.25;
    const hlY = cy - radius * 0.3;
    const highlight = ctx.createRadialGradient(hlX, hlY, 0, hlX, hlY, radius * 0.5);
    highlight.addColorStop(0, `rgba(255,255,255,${0.04 + vol * 0.03})`);
    highlight.addColorStop(0.4, "rgba(255,255,255,0.015)");
    highlight.addColorStop(1, "transparent");
    ctx.fillStyle = highlight;
    ctx.fillRect(0, 0, s, s);

    // ── Soft rim ──
    ctx.globalCompositeOperation = "source-over";
    const rim = ctx.createRadialGradient(cx, cy, radius * 0.88, cx, cy, radius);
    rim.addColorStop(0, "transparent");
    rim.addColorStop(0.6, "transparent");
    rim.addColorStop(1, `rgba(${cc[2][0]},${cc[2][1]},${cc[2][2]},${0.08 + vol * 0.06})`);
    ctx.fillStyle = rim;
    ctx.fillRect(0, 0, s, s);

    ctx.restore();

    animRef.current = requestAnimationFrame(render);
  }, [size]);

  // ─── Canvas setup + start loop ──────────────────────────────────────────
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;

    const dpr = window.devicePixelRatio || 1;
    canvas.width = size * dpr;
    canvas.height = size * dpr;
    const ctx = canvas.getContext("2d");
    if (ctx) ctx.scale(dpr, dpr);

    animRef.current = requestAnimationFrame(render);
    return () => cancelAnimationFrame(animRef.current);
  }, [render, size]);

  return (
    <div className="relative flex flex-col items-center">
      <canvas
        ref={canvasRef}
        style={{
          width: size,
          height: size,
          transition: "filter 1s ease",
          filter:
            kiraState === "thinking"
              ? "brightness(0.82) saturate(0.85)"
              : kiraState === "speaking"
                ? "brightness(1.08)"
                : "brightness(1.0)",
        }}
      />
      {/* State indicator */}
      <div
        className="mt-2 text-[11px] tracking-[0.2em] uppercase font-light transition-colors duration-500"
        style={{ color: "rgba(139,157,195,0.35)", height: 16 }}
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
