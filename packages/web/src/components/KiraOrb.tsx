"use client";

import { useEffect, useRef, useCallback } from "react";
import type { KiraState } from "@/hooks/useKiraSocket";

// ─── Sentiment palette ──────────────────────────────────────────────────────
// The server can set these in the future via a WS message.
// For now, "neutral" is the default.
const SENTIMENTS: Record<string, { primary: string; secondary: string; accent: string }> = {
  neutral: { primary: "#6B7DB3", secondary: "#4A5A8A", accent: "#8B9DC3" },
  warm:    { primary: "#C4785A", secondary: "#A85A3A", accent: "#E8A07A" },
  cool:    { primary: "#5A8FA0", secondary: "#3A6F80", accent: "#7AB0C0" },
  tender:  { primary: "#9B7AAA", secondary: "#7B5A8A", accent: "#BB9ACA" },
  playful: { primary: "#B08A5A", secondary: "#90703A", accent: "#D0AA7A" },
};

export type Sentiment = keyof typeof SENTIMENTS;

interface KiraOrbProps {
  kiraState: KiraState;
  micVolume: number;       // 0-1  (from useKiraSocket)
  speakerVolume: number;   // 0-1  (playerVolume from useKiraSocket)
  sentiment?: Sentiment;
  /** CSS px – defaults to 280 */
  size?: number;
}

// ─── Helpers ─────────────────────────────────────────────────────────────────
const lerp = (a: number, b: number, t: number) => a + (b - a) * t;

const lerpColor = (hex1: string, hex2: string, t: number): string => {
  const r1 = parseInt(hex1.slice(1, 3), 16),
    g1 = parseInt(hex1.slice(3, 5), 16),
    b1 = parseInt(hex1.slice(5, 7), 16);
  const r2 = parseInt(hex2.slice(1, 3), 16),
    g2 = parseInt(hex2.slice(3, 5), 16),
    b2 = parseInt(hex2.slice(5, 7), 16);
  const r = Math.round(lerp(r1, r2, t)),
    g = Math.round(lerp(g1, g2, t)),
    b = Math.round(lerp(b1, b2, t));
  return `#${r.toString(16).padStart(2, "0")}${g.toString(16).padStart(2, "0")}${b.toString(16).padStart(2, "0")}`;
};

interface Blob {
  x: number;
  y: number;
  radius: number;
  baseRadius: number;
  phase: number;
  phaseSpeed: number;
  orbitRadius: number;
  orbitSpeed: number;
  orbitPhase: number;
}

// ─── Component ───────────────────────────────────────────────────────────────
export default function KiraOrb({
  kiraState,
  micVolume,
  speakerVolume,
  sentiment = "neutral",
  size = 280,
}: KiraOrbProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const animRef = useRef<number>(0);
  const timeRef = useRef(0);
  const blobsRef = useRef<Blob[]>([]);
  const targetColorsRef = useRef(SENTIMENTS.neutral);
  const currentColorsRef = useRef({ ...SENTIMENTS.neutral });
  const volumeRef = useRef(0);
  const stateRef = useRef<KiraState>("listening");

  // Keep refs in sync (synchronous — no React batching delay)
  const micRef = useRef(micVolume);
  micRef.current = micVolume;
  const spkRef = useRef(speakerVolume);
  spkRef.current = speakerVolume;
  stateRef.current = kiraState;

  // Colour target
  useEffect(() => {
    targetColorsRef.current = SENTIMENTS[sentiment];
  }, [sentiment]);

  // Initialise metaball blobs once
  useEffect(() => {
    blobsRef.current = Array.from({ length: 8 }, () => ({
      x: 0,
      y: 0,
      radius: 30 + Math.random() * 40,
      baseRadius: 30 + Math.random() * 40,
      phase: Math.random() * Math.PI * 2,
      phaseSpeed: 0.3 + Math.random() * 0.5,
      orbitRadius: 20 + Math.random() * 60,
      orbitSpeed: 0.2 + Math.random() * 0.4,
      orbitPhase: Math.random() * Math.PI * 2,
    }));
  }, []);

  // ─── Render loop ────────────────────────────────────────────────────────
  const render = useCallback(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    const dt = 0.016;
    timeRef.current += dt;
    const t = timeRef.current;

    // Read live values from refs (no React re-render dependency)
    const state = stateRef.current;
    const mic = micRef.current;
    const spk = spkRef.current;

    // Smooth colour transition
    const tc = targetColorsRef.current;
    const cc = currentColorsRef.current;
    cc.primary = lerpColor(cc.primary, tc.primary, 0.02);
    cc.secondary = lerpColor(cc.secondary, tc.secondary, 0.02);
    cc.accent = lerpColor(cc.accent, tc.accent, 0.02);

    // Volume reactivity
    let targetVol = 0;
    if (state === "listening") targetVol = mic;
    else if (state === "speaking") targetVol = spk;
    else targetVol = 0.1; // thinking — subtle pulse
    volumeRef.current = lerp(volumeRef.current, targetVol, 0.08);
    const vol = volumeRef.current;

    // State-specific behaviour
    let globalSpeed = 1;
    let globalScale = 1;
    let pulseIntensity = 0;
    let breatheSpeed = 1;

    if (state === "thinking") {
      globalSpeed = 0.4;
      pulseIntensity = 0.15 * Math.sin(t * 1.5) + 0.15;
      breatheSpeed = 0.6;
      globalScale = 0.95 + pulseIntensity * 0.1;
    } else if (state === "speaking") {
      globalSpeed = 1.2 + vol * 1.5;
      globalScale = 1.0 + vol * 0.2;
      breatheSpeed = 1.5;
    } else {
      globalSpeed = 0.7 + vol * 2;
      globalScale = 0.98 + vol * 0.15;
      breatheSpeed = 0.8;
    }

    // ── Canvas dimensions (match CSS size via DPR) ─────────────────────
    const s = size; // logical pixels
    const cx = s / 2,
      cy = s / 2;

    ctx.clearRect(0, 0, s, s);

    // Outer glow
    const glowSize = 100 + vol * 40;
    const outerGlow = ctx.createRadialGradient(cx, cy, 50, cx, cy, glowSize + 50);
    outerGlow.addColorStop(0, cc.primary + "15");
    outerGlow.addColorStop(0.5, cc.primary + "08");
    outerGlow.addColorStop(1, "transparent");
    ctx.fillStyle = outerGlow;
    ctx.fillRect(0, 0, s, s);

    // Update blobs
    const blobs = blobsRef.current;
    for (let i = 0; i < blobs.length; i++) {
      const b = blobs[i];
      b.orbitPhase += b.orbitSpeed * dt * globalSpeed;
      b.phase += b.phaseSpeed * dt * globalSpeed;

      const breathe = Math.sin(t * breatheSpeed + b.phase) * 0.15;
      const volPush = vol * 0.4;

      b.x = cx + Math.cos(b.orbitPhase) * b.orbitRadius * (1 + volPush) * globalScale;
      b.y = cy + Math.sin(b.orbitPhase * 1.3 + b.phase * 0.5) * b.orbitRadius * (1 + volPush) * globalScale;
      b.radius = b.baseRadius * (1 + breathe + vol * 0.3) * globalScale;
    }

    // ── Metaball field render ──────────────────────────────────────────
    const imageData = ctx.createImageData(s, s);
    const data = imageData.data;

    const pr = parseInt(cc.primary.slice(1, 3), 16);
    const pg = parseInt(cc.primary.slice(3, 5), 16);
    const pb = parseInt(cc.primary.slice(5, 7), 16);
    const sr = parseInt(cc.secondary.slice(1, 3), 16);
    const sg = parseInt(cc.secondary.slice(3, 5), 16);
    const sb = parseInt(cc.secondary.slice(5, 7), 16);
    const ar = parseInt(cc.accent.slice(1, 3), 16);
    const ag = parseInt(cc.accent.slice(3, 5), 16);
    const ab = parseInt(cc.accent.slice(5, 7), 16);

    const step = 2; // half-res for performance
    for (let y = 0; y < s; y += step) {
      for (let x = 0; x < s; x += step) {
        let field = 0;
        for (let i = 0; i < blobs.length; i++) {
          const b = blobs[i];
          const dx = x - b.x;
          const dy = y - b.y;
          const distSq = dx * dx + dy * dy;
          field += (b.radius * b.radius) / distSq;
        }

        if (field > 1.0) {
          const edgeFactor = Math.min(1, (field - 1.0) * 2);
          const depthFactor = Math.min(1, (field - 1.0) * 0.5);

          let r = lerp(pr, sr, depthFactor);
          let g = lerp(pg, sg, depthFactor);
          let bv = lerp(pb, sb, depthFactor);

          // Internal lava flow
          const flowX = Math.sin(x * 0.02 + t * 0.8) * Math.cos(y * 0.015 + t * 0.6);
          const flowY = Math.cos(x * 0.015 - t * 0.5) * Math.sin(y * 0.02 + t * 0.7);
          const flow = (flowX + flowY) * 0.5 + 0.5;
          const flowIntensity = depthFactor * flow * 0.6;

          r = lerp(r, ar, flowIntensity);
          g = lerp(g, ag, flowIntensity);
          bv = lerp(bv, ab, flowIntensity);

          // Highlights
          const highlight = Math.pow(flow, 3) * depthFactor * 0.4;
          r = Math.min(255, r + highlight * 80);
          g = Math.min(255, g + highlight * 60);
          bv = Math.min(255, bv + highlight * 40);

          // Edge glow
          const edgeGlow = Math.pow(1 - edgeFactor, 2) * 0.6;
          r = Math.min(255, r + edgeGlow * 60);
          g = Math.min(255, g + edgeGlow * 50);
          bv = Math.min(255, bv + edgeGlow * 40);

          const alpha = Math.min(255, edgeFactor * 280);

          for (let sy = 0; sy < step && y + sy < s; sy++) {
            for (let sx = 0; sx < step && x + sx < s; sx++) {
              const idx = ((y + sy) * s + (x + sx)) * 4;
              data[idx] = r;
              data[idx + 1] = g;
              data[idx + 2] = bv;
              data[idx + 3] = alpha;
            }
          }
        }
      }
    }

    ctx.putImageData(imageData, 0, 0);

    // Soft inner glow overlay
    const innerGlow = ctx.createRadialGradient(
      cx + Math.sin(t * 0.7) * 15,
      cy + Math.cos(t * 0.5) * 15,
      0,
      cx,
      cy,
      80 * globalScale
    );
    innerGlow.addColorStop(0, cc.accent + "20");
    innerGlow.addColorStop(0.6, cc.primary + "08");
    innerGlow.addColorStop(1, "transparent");
    ctx.globalCompositeOperation = "screen";
    ctx.fillStyle = innerGlow;
    ctx.beginPath();
    ctx.arc(cx, cy, 120, 0, Math.PI * 2);
    ctx.fill();
    ctx.globalCompositeOperation = "source-over";

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

  // CSS brightness driven by state + volume
  const brightness =
    kiraState === "speaking"
      ? 1.1 + speakerVolume * 0.2
      : kiraState === "thinking"
        ? 0.85
        : 1;

  return (
    <div className="relative">
      <canvas
        ref={canvasRef}
        style={{
          width: size,
          height: size,
          filter: `blur(1px) brightness(${brightness})`,
          transition: "filter 0.5s ease",
        }}
      />
      {/* State label */}
      <div
        className="absolute -bottom-2 left-1/2 -translate-x-1/2 text-[13px] tracking-[0.15em] uppercase font-light transition-colors duration-1000"
        style={{ color: currentColorsRef.current.accent + "90" }}
      >
        {kiraState === "listening"
          ? "Listening..."
          : kiraState === "thinking"
            ? "Thinking..."
            : "Speaking..."}
      </div>
    </div>
  );
}
