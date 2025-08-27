'use client';
import { useEffect, useRef, useState } from 'react';
import { playMp3Base64 } from '@/lib/audio';

export default function HotMic({
  onResult,
  onPaywall,
  disabled
}: {
  onResult: (t: { user: string; reply: string; estSeconds?: number }) => void;
  onPaywall?: () => void;
  disabled?: boolean;
}) {
  const [active, setActive] = useState(false);
  const [busy, setBusy] = useState(false);
  const [playing, setPlaying] = useState<HTMLAudioElement | null>(null);
  const mediaRef = useRef<MediaStream | null>(null);
  const recRef = useRef<MediaRecorder | null>(null);
  const chunksRef = useRef<BlobPart[]>([]);
  const vadRef = useRef<{ ctx: AudioContext; src: MediaStreamAudioSourceNode; analyser: AnalyserNode } | null>(null);

  useEffect(() => {
    return () => {
      stopAll();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  async function toggle() {
    if (disabled || busy) return;
    if (active) {
      setActive(false);
      await stopAll();
      return;
    }
    // start
    setActive(true);
    await beginCapture();
  }

  async function beginCapture() {
    chunksRef.current = [];
    const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
    mediaRef.current = stream;
    const rec = new MediaRecorder(stream, { mimeType: 'audio/webm' });
    recRef.current = rec;
    rec.ondataavailable = (e) => chunksRef.current.push(e.data);
    rec.onstop = onStopRecording;
    rec.start();
    await startVad(stream);
  }

  async function startVad(stream: MediaStream) {
    const ctx = new AudioContext();
    const src = ctx.createMediaStreamSource(stream);
    const analyser = ctx.createAnalyser();
    analyser.fftSize = 512;
    src.connect(analyser);
    vadRef.current = { ctx, src, analyser };

    const buf = new Uint8Array(analyser.frequencyBinCount);
    let silenceFrames = 0;
    const maxSilenceFrames = 60; // ~2s at 30fps loop

    const loop = () => {
      if (!vadRef.current) return;
      analyser.getByteFrequencyData(buf);
      const rms = Math.sqrt(buf.reduce((a, b) => a + b * b, 0) / buf.length) / 255;
      if (rms < 0.05) silenceFrames++;
      else silenceFrames = 0;
  if (silenceFrames > maxSilenceFrames) {
        // stop capture and send
        recRef.current?.stop();
        vadRef.current?.ctx.close();
        vadRef.current = null;
        return;
      }
      requestAnimationFrame(loop);
    };
    requestAnimationFrame(loop);
  }

  async function onStopRecording() {
    const stream = mediaRef.current;
    mediaRef.current = null;
    stream?.getTracks().forEach((t) => t.stop());

    if (chunksRef.current.length === 0) return;
    setBusy(true);
    if (playing) { playing.pause(); setPlaying(null); }

    const supabaseAccessToken = (await (await import('@/lib/supabaseClient')).getSupabaseBrowser()
      .auth.getSession()).data.session?.access_token;

    const audioBlob = new Blob(chunksRef.current, { type: 'audio/webm' });
    const fd = new FormData();
    fd.append('audio', audioBlob, 'audio.webm');

    const res = await fetch('/api/utterance', {
      method: 'POST',
      headers: { Authorization: `Bearer ${supabaseAccessToken}` },
      body: fd
    });

    if (res.status === 402) {
      setBusy(false);
      onPaywall?.();
      return;
    }

    const j = await res.json();
    onResult({ user: j.transcript, reply: j.reply, estSeconds: j.estSeconds });
    const a = await playMp3Base64(j.audioMp3Base64, () => setPlaying(null));
    setPlaying(a);
    setBusy(false);
    chunksRef.current = [];
    // resume capture for continuous conversation if still active
    if (active) {
      await beginCapture();
    }
  }

  async function stopAll() {
    recRef.current?.state === 'recording' && recRef.current.stop();
    recRef.current = null;
    mediaRef.current?.getTracks().forEach((t) => t.stop());
    mediaRef.current = null;
    if (vadRef.current) { await vadRef.current.ctx.close(); vadRef.current = null; }
  }

  return (
    <button
      onClick={toggle}
      disabled={disabled || busy}
      className="relative inline-flex items-center justify-center h-40 w-40 rounded-full"
      title={disabled ? 'Trial exhausted' : active ? 'Click to stop' : 'Click to talk'}
      style={{
        boxShadow: active ? '0 0 44px #8b5cf6' : '0 0 24px #4c1d95',
        background: active ? 'radial-gradient(circle at 35% 25%, #a78bfa, #6d28d9)' : 'radial-gradient(circle at 35% 25%, #7c3aed, #1f1033)'
      }}
    >
      {!active ? (
        <div className="text-gray-100 text-sm select-none">Click to talk</div>
      ) : (
        <div className="flex flex-col items-center gap-2">
          <img src="/logo.png" alt="Kira" className="h-10 w-10 opacity-90" />
          <div className="text-xs text-gray-300">Listening…</div>
        </div>
      )}
    </button>
  );
}
