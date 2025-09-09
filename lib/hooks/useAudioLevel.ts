'use client';
import { useEffect, useRef, useState } from 'react';

// Reads audio level (RMS) from an <audio> element using Web Audio API.
// Returns normalized level 0..1 plus basic speaking detection.
export function useAudioLevel(opts: { audioEl?: HTMLAudioElement | null; smoothing?: number } = {}) {
  const { audioEl, smoothing = 0.85 } = opts;
  const [level, setLevel] = useState(0); // 0..1
  const [isSpeaking, setSpeaking] = useState(false);
  const raf = useRef(0);
  const analyserRef = useRef<AnalyserNode | null>(null);
  const srcRef = useRef<MediaElementAudioSourceNode | null>(null);

  useEffect(() => {
    if (!audioEl) return;
    try {
      const Ctx: typeof AudioContext = (window as any).AudioContext || (window as any).webkitAudioContext;
      if (!Ctx) return;
      const ctx = new Ctx();
      const analyser = ctx.createAnalyser();
      analyser.fftSize = 2048;
      const src = ctx.createMediaElementSource(audioEl);
      src.connect(analyser);
      analyser.connect(ctx.destination);
      analyserRef.current = analyser;
      srcRef.current = src;

      const data = new Uint8Array(analyser.frequencyBinCount);
      let smoothed = 0;

      const loop = () => {
        analyser.getByteTimeDomainData(data);
        let sum = 0;
        const len = data.length | 0;
        for (let i = 0; i < len; i++) {
          const sample = data[i]!; // Uint8Array indexing always returns a number
          const v = (sample - 128) / 128;
          sum += v * v;
        }
        const rms = Math.sqrt(sum / data.length);
        smoothed = smoothing * smoothed + (1 - smoothing) * rms;
        const norm = Math.min(1, Math.max(0, (smoothed - 0.02) / 0.3));
        setLevel(norm);
        setSpeaking(audioEl.currentTime > 0 && !audioEl.paused && !audioEl.ended && audioEl.readyState >= 2);
        raf.current = requestAnimationFrame(loop);
      };
      raf.current = requestAnimationFrame(loop);

      return () => {
        cancelAnimationFrame(raf.current);
        try { src.disconnect(); analyser.disconnect(); ctx.close(); } catch {}
      };
    } catch {
      // Silently ignore if Web Audio is unavailable
    }
  }, [audioEl, smoothing]);

  return { level, isSpeaking };
}
