"use client";

import { useEffect, useRef, useState } from "react";
import { playMp3Base64 } from "@/lib/audio";
import { ensureAnonSession } from "@/lib/client-api";
import { supabase } from "@/lib/supabaseClient";
import { getUsageState, updateUsage } from "@/lib/usageTracking";

type HotMicProps = {
  onResult: (t: { user: string; reply: string; estSeconds?: number }) => void;
  onPaywall?: () => void;
  disabled?: boolean;
  mode?: "mic" | "launcher";
  conversationId?: string | null;
  outOfMinutes?: boolean;
};

const MIN_RECORDING_DURATION_MS = 1500;
const VAD_SILENCE_THRESHOLD_S = 10.0;
const VAD_WARMUP_MS = 750;
const VAD_RMS_SENSITIVITY = 0.06;

export default function HotMic({ onResult, onPaywall, disabled, mode = "mic", conversationId, outOfMinutes }: HotMicProps) {
  const isLauncher = mode === "launcher";

  const [active, setActive] = useState(false);
  const [busy, setBusy] = useState(false);
  const [status, setStatus] = useState<"idle" | "listening" | "thinking" | "speaking" | "error" | "outOfTime">("idle");
  const [playing, setPlaying] = useState<HTMLAudioElement | null>(null);
  const [micVolume, setMicVolume] = useState(0);
  const [usage, setUsage] = useState(getUsageState());

  const mediaRef = useRef<MediaStream | null>(null);
  const recRef = useRef<MediaRecorder | null>(null);
  const chunksRef = useRef<BlobPart[]>([]);
  const vadRef = useRef<{ ctx: AudioContext; src: MediaStreamAudioSourceNode; analyser: AnalyserNode } | null>(null);
  const recordingStartTime = useRef<number>(0);

  // Poll usage from localStorage so we can reflect changes live
  useEffect(() => {
    setUsage(getUsageState());
    const interval = setInterval(() => setUsage(getUsageState()), 5000);
    return () => clearInterval(interval);
  }, []);

  const handleClick = () => {
    const current = getUsageState();
    if ((outOfMinutes || current.secondsRemaining <= 0) && current.plan === 'free') {
      setStatus('outOfTime');
      setTimeout(() => setStatus('idle'), 1500);
      onPaywall?.();
      return;
    }
    if (disabled || busy) return;
    if (isLauncher) { onPaywall?.(); return; }
    setActive((v) => !v);
  };

  useEffect(() => {
    if (isLauncher) return; // never start mic in launcher mode
    if (active && status === "idle" && usage.secondsRemaining > 0) beginCapture();
    else if (!active) stopAll();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [active, status, isLauncher, usage.secondsRemaining]);

  useEffect(() => () => { stopAll(); }, []);

  async function beginCapture() {
    if (status !== "idle") return;

    forceCleanup();
    await ensureAnonSession().catch(() => {});
    chunksRef.current = [];
    recordingStartTime.current = Date.now();

    let stream: MediaStream;
    try {
      stream = await navigator.mediaDevices.getUserMedia({ audio: true });
    } catch {
      alert("Microphone permission is required.");
      setActive(false);
      return;
    }
    mediaRef.current = stream;

    const rec = new MediaRecorder(stream, { mimeType: "audio/webm;codecs=opus" });
    recRef.current = rec;
    rec.ondataavailable = (e) => chunksRef.current.push(e.data);
    rec.onstop = onStopRecording;
    rec.start();
    setStatus("listening");
    startVad(stream);
  }

  function startVad(stream: MediaStream) {
    const ctx = new AudioContext();
    const src = ctx.createMediaStreamSource(stream);
    const analyser = ctx.createAnalyser();
    analyser.fftSize = 512;
    src.connect(analyser);
    vadRef.current = { ctx, src, analyser };

    const buf = new Uint8Array(analyser.frequencyBinCount);
    const frameDuration = analyser.fftSize / ctx.sampleRate;
    const maxSilenceFrames = VAD_SILENCE_THRESHOLD_S / frameDuration;
    const warmupFrames = VAD_WARMUP_MS / (frameDuration * 1000);

    let silenceFrames = 0;
    let frameCount = 0;

    const loop = () => {
      if (!recRef.current || recRef.current.state !== "recording") {
        setMicVolume(0);
        return;
      }
      analyser.getByteFrequencyData(buf);
      const rms = Math.sqrt(buf.reduce((a, b) => a + b * b, 0) / buf.length) / 255;
      setMicVolume(rms);

      frameCount++;
      if (frameCount > warmupFrames) {
        if (rms < VAD_RMS_SENSITIVITY) silenceFrames++;
        else silenceFrames = 0;
      }
      if (silenceFrames > maxSilenceFrames) recRef.current.stop();
      else requestAnimationFrame(loop);
    };
    requestAnimationFrame(loop);
  }

  async function onStopRecording() {
    if (!active) return;
    setStatus("thinking");

    const duration = Date.now() - recordingStartTime.current;
    if (duration < MIN_RECORDING_DURATION_MS || chunksRef.current.length === 0) {
      chunksRef.current = [];
      setStatus("idle");
      return;
    }

    setBusy(true);
    const audioBlob = new Blob(chunksRef.current, { type: "audio/webm" });
    chunksRef.current = [];

    const { data: { session } } = await supabase.auth.getSession();
    const fd = new FormData();
    fd.append("audio", audioBlob, "audio.webm");
    const headers: Record<string, string> = session?.access_token ? { Authorization: `Bearer ${session.access_token}` } : {};

    try {
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), 30000);
      const url = new URL('/api/utterance', window.location.origin);
      if (conversationId) url.searchParams.set('conversationId', conversationId);
      const res = await fetch(url.toString(), { method: "POST", headers, body: fd, signal: controller.signal });
      clearTimeout(timeoutId);

      if (res.status === 402) {
        onPaywall?.();
        setActive(false);
        return;
      }
      if (!res.ok) throw new Error(`Server error: ${res.status}`);

      const j = await res.json();
      onResult({ user: j.transcript, reply: j.reply, estSeconds: j.estSeconds });

      // Update usage tracking locally for Free users based on estimated TTS seconds
      if (typeof j.estSeconds === 'number' && j.estSeconds > 0) {
        const newUsage = updateUsage(j.estSeconds);
        setUsage(newUsage);
        if (newUsage.secondsRemaining <= 0) onPaywall?.();
      }

      const done = () => { setPlaying(null); setStatus("idle"); };
      if (j.audioMp3Base64) {
        const a = await playMp3Base64(j.audioMp3Base64, done);
        setPlaying(a);
        setStatus("speaking");
      } else {
        done();
      }
    } catch (err) {
  console.error("Utterance error:", err);
  setStatus("error");
      setTimeout(() => setStatus("idle"), 2000);
    } finally {
      setBusy(false);
    }
  }

  function forceCleanup() {
    if (playing) {
      playing.pause();
      setPlaying(null);
    }
    if (recRef.current) {
      recRef.current.onstop = null;
      if (recRef.current.state === "recording") recRef.current.stop();
    }
    mediaRef.current?.getTracks().forEach((t) => t.stop());
    vadRef.current?.ctx.close().catch(() => {});
    recRef.current = null;
    mediaRef.current = null;
    vadRef.current = null;
  }

  function stopAll() {
    forceCleanup();
    if (status !== "idle") setStatus("idle");
    setActive(false);
  }

  const orbScale = 1 + (isLauncher ? 0 : micVolume * 0.5);

  return (
    <button
      onClick={handleClick}
      disabled={disabled || busy || usage.secondsRemaining <= 0}
      className="relative inline-flex items-center justify-center h-40 w-40 rounded-full transition-transform duration-100 ease-out"
      title={
        usage.secondsRemaining <= 0 ? "Daily limit reached — click to upgrade" : isLauncher ? "Daily limit reached — click to upgrade" : disabled || busy ? "Unavailable" : active ? "Click to stop" : "Click to talk"
      }
      style={{
        boxShadow: active && !isLauncher ? "0 0 44px #8b5cf6" : "0 0 24px #4c1d95",
        background:
          active && !isLauncher
            ? "radial-gradient(circle at 35% 25%, #a78bfa, #6d28d9)"
            : usage.secondsRemaining <= 0
            ? "radial-gradient(circle at 35% 25%, #7c3aed, #1f1033, #000)"
            : "radial-gradient(circle at 35% 25%, #7c3aed, #1f1033)",
        transform: `scale(${orbScale})`,
        opacity: usage.secondsRemaining <= 0 ? 0.7 : 1,
      }}
    >
      <div className="text-gray-100 text-sm select-none px-3 text-center leading-snug">
        {usage.secondsRemaining <= 0 ? (
          "Time's up! Upgrade to continue"
        ) : status === 'outOfTime' ? (
          "No time remaining"
        ) : isLauncher || outOfMinutes ? (
          "Daily limit reached — Upgrade to keep talking"
        ) : active ? (
          <div className="flex flex-col items-center gap-2">
            <img src="/logo.png" alt="Kira" className="h-10 w-10 opacity-90" />
            <div className="text-xs text-gray-300">
              {status === "thinking" ? "Thinking…" : status === "speaking" ? "Speaking…" : status === "error" ? "Error" : "Listening…"}
            </div>
          </div>
        ) : (
          "Click to talk"
        )}
      </div>
      {usage.secondsRemaining > 0 && (
        <div className="absolute -bottom-2 left-0 right-0">
          <div className="bg-white/10 rounded-full h-1 mx-4">
            <div 
              className="bg-fuchsia-500 h-1 rounded-full transition-all duration-300"
              style={{ 
                width: `${(usage.secondsRemaining / (15 * 60)) * 100}%` 
              }}
            />
          </div>
          <div className="text-xs text-white/50 mt-1">
            {Math.ceil(usage.secondsRemaining / 60)}m left today
          </div>
        </div>
      )}
    </button>
  );
}