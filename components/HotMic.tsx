'use client';
import { useEffect, useRef, useState } from 'react';
import { playMp3Base64 } from '@/lib/audio';
import { ensureAnonSession } from '@/lib/client-api';
import { supabase } from '@/lib/supabaseClient';

// ===================================================================================
// TUNING & CONFIGURATION
// ===================================================================================
const MIN_RECORDING_DURATION_MS = 1500;
const VAD_SILENCE_THRESHOLD_S = 10.0;
const VAD_WARMUP_MS = 750;
const VAD_RMS_SENSITIVITY = 0.06;
// ===================================================================================

export default function HotMic({
  onResult,
  onPaywall,
  disabled,
  /** when true, clicking the orb opens the paywall immediately */
  forcePaywall = false,
}: {
  onResult: (t: { user: string; reply: string; estSeconds?: number }) => void;
  onPaywall?: () => void;
  disabled?: boolean;
  forcePaywall?: boolean;
}) {
  const [active, setActive] = useState(false);
  const [busy, setBusy] = useState(false);
  const [status, setStatus] = useState<'idle'|'listening'|'thinking'|'speaking'>('idle');
  const [playing, setPlaying] = useState<HTMLAudioElement | null>(null);
  const [micVolume, setMicVolume] = useState(0);
  
  const mediaRef = useRef<MediaStream | null>(null);
  const recRef = useRef<MediaRecorder | null>(null);
  const chunksRef = useRef<BlobPart[]>([]);
  const vadRef = useRef<{ ctx: AudioContext; src: MediaStreamAudioSourceNode; analyser: AnalyserNode } | null>(null);
  const recordingStartTime = useRef<number>(0);

  useEffect(() => {
    if (active && status === 'idle') {
      beginCapture();
    } else if (!active) {
      stopAll();
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [active, status]);

  useEffect(() => {
    return () => { stopAll(); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  function toggle() {
    if (disabled || busy) return;
    // if user is out of minutes, don't touch the mic—just show paywall.
    if (forcePaywall) {
      onPaywall?.();
      return;
    }
    setActive(!active);
  }

  async function beginCapture() {
    if (status !== 'idle') return;

    // Force cleanup of any old resources before starting
    forceCleanup();

    await ensureAnonSession().catch(() => {});
    
    chunksRef.current = [];
    recordingStartTime.current = Date.now();
    let stream: MediaStream;
    try {
      stream = await navigator.mediaDevices.getUserMedia({ audio: true });
    } catch (e) {
      alert('Microphone permission is required.');
      setActive(false);
      return;
    }
    mediaRef.current = stream;

    const rec = new MediaRecorder(stream, { mimeType: 'audio/webm;codecs=opus' });
    recRef.current = rec;
    rec.ondataavailable = (e) => chunksRef.current.push(e.data);
    rec.onstop = onStopRecording;
    rec.start();
    setStatus('listening');
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
      if (!recRef.current || recRef.current.state !== 'recording') {
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
      
      if (silenceFrames > maxSilenceFrames) {
        recRef.current.stop();
      } else {
        requestAnimationFrame(loop);
      }
    };
    requestAnimationFrame(loop);
  }

  async function onStopRecording() {
    // If the session was deactivated manually, don't process audio
    if (!active) return; 

    setStatus('thinking');

    const duration = Date.now() - recordingStartTime.current;
    if (duration < MIN_RECORDING_DURATION_MS || chunksRef.current.length === 0) {
      chunksRef.current = [];
      setStatus('idle');
      return;
    }

    setBusy(true);
    const audioBlob = new Blob(chunksRef.current, { type: 'audio/webm' });
    chunksRef.current = [];

    const { data: { session } } = await supabase.auth.getSession();
    const fd = new FormData();
    fd.append('audio', audioBlob, 'audio.webm');
    const headers: Record<string, string> = session?.access_token ? { Authorization: `Bearer ${session.access_token}` } : {};
    
    try {
        const res = await fetch('/api/utterance', { method: 'POST', headers, body: fd });
        
        if (res.status === 402) {
            onPaywall?.();
            setActive(false);
            return;
        }
        if (!res.ok) throw new Error(`Server error: ${res.status}`);
        
        const j = await res.json();
        onResult({ user: j.transcript, reply: j.reply, estSeconds: j.estSeconds });
        
        const handlePlaybackEnd = () => { setPlaying(null); setStatus('idle'); };
        
        if (j.audioMp3Base64) {
            const a = await playMp3Base64(j.audioMp3Base64, handlePlaybackEnd);
            setPlaying(a);
            setStatus('speaking');
        } else {
            handlePlaybackEnd();
        }
    } catch (err) {
        console.error("Utterance error:", err);
        setStatus('idle');
    } finally {
        setBusy(false);
    }
  }

  function forceCleanup() {
    if (playing) { playing.pause(); setPlaying(null); }
    if (recRef.current) {
        recRef.current.onstop = null;
        if (recRef.current.state === 'recording') recRef.current.stop();
    }
    mediaRef.current?.getTracks().forEach((t) => t.stop());
    vadRef.current?.ctx.close().catch(() => {});
    
    recRef.current = null;
    mediaRef.current = null;
    vadRef.current = null;
  }

  function stopAll() {
    forceCleanup();
    if (status !== 'idle') setStatus('idle');
  }

  const orbScale = 1 + micVolume * 0.5;
  const title = forcePaywall
    ? 'Daily limit reached — click to upgrade'
    : disabled || busy
      ? 'Unavailable'
      : active
        ? 'Click to stop'
        : 'Click to talk';

  return (
    <button
      onClick={toggle}
      disabled={disabled || busy /* NOT disabled by forcePaywall */}
      className="relative inline-flex items-center justify-center h-40 w-40 rounded-full transition-transform duration-100 ease-out"
      title={title}
      style={{
        boxShadow: active ? '0 0 44px #8b5cf6' : '0 0 24px #4c1d95',
        background: active ? 'radial-gradient(circle at 35% 25%, #a78bfa, #6d28d9)' : 'radial-gradient(circle at 35% 25%, #7c3aed, #1f1033)',
        transform: `scale(${orbScale})`
      }}
    >
      {!active ? (
        <div className="text-gray-100 text-sm select-none">
          {forcePaywall ? 'Upgrade to keep talking' : 'Click to talk'}
        </div>
      ) : (
        <div className="flex flex-col items-center gap-2">
          <img src="/logo.png" alt="Kira" className="h-10 w-10 opacity-90" />
          <div className="text-xs text-gray-300">{status === 'thinking' ? 'Thinking…' : status === 'speaking' ? 'Speaking…' : 'Listening…'}</div>
        </div>
      )}
    </button>
  );
}