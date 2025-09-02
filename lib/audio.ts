function isMobile(): boolean {
  if (typeof navigator === 'undefined') return false;
  return /Mobi/i.test(navigator.userAgent || '');
}
export async function playMp3Base64(b64: string, onEnd?: () => void) {
  const binary = atob(b64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  const blob = new Blob([bytes], { type: 'audio/mpeg' });
  const url = URL.createObjectURL(blob);
  const audio = new Audio(url);
  audio.onended = () => { URL.revokeObjectURL(url); onEnd?.(); };
  await audio.play();
  return audio;
}

export async function playEarcon() {
  const AC: any = (window as any).AudioContext || (window as any).webkitAudioContext;
  if (!AC) return;
  const ctx = new AC();
  const osc = ctx.createOscillator();
  const gain = ctx.createGain();
  osc.type = 'sine';
  osc.frequency.value = 880;
  gain.gain.value = 0.0001;
  osc.connect(gain);
  gain.connect(ctx.destination);
  const now = ctx.currentTime;
  osc.start();
  gain.gain.exponentialRampToValueAtTime(0.05, now + 0.02);
  gain.gain.exponentialRampToValueAtTime(0.00001, now + 0.20);
  osc.stop(now + 0.22);
}

// Analyze and play MP3 base64 audio, providing live volume updates.
export async function playAndAnalyzeAudio(
  b64: string,
  onVolumeChange: (volume: number) => void,
  onEnd?: () => void
) {
  const AC: any = (window as any).AudioContext || (window as any).webkitAudioContext;
  if (!AC) {
    // Fallback: just play with HTMLAudio if Web Audio not available
    try {
      const a = await playMp3Base64(b64, onEnd);
      // No analysis; emit zero once
      try { onVolumeChange(0); } catch {}
      return a as any;
    } catch (e) {
      throw e;
    }
  }
  const audioContext = new AC();
  const analyser = audioContext.createAnalyser();
  analyser.fftSize = 32; // lightweight analysis

  // Decode base64 mp3 into ArrayBuffer
  const binary = atob(b64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  const arrayBuffer = bytes.buffer as ArrayBuffer;

  // Some AudioContext implementations require copy for decodeAudioData
  const buf = arrayBuffer.slice(0);
  const audioBuffer: AudioBuffer = await new Promise((resolve, reject) => {
    // decodeAudioData has both promise and callback forms across browsers
    const maybePromise = (audioContext as any).decodeAudioData(buf, resolve, reject);
    if (maybePromise?.then) maybePromise.then(resolve).catch(reject);
  });

  const source = audioContext.createBufferSource();
  source.buffer = audioBuffer;
  source.connect(analyser);
  analyser.connect(audioContext.destination);

  const bufferLength = analyser.frequencyBinCount;
  const dataArray = new Uint8Array(bufferLength);
  let rafId = 0;

  const draw = () => {
    try {
      analyser.getByteFrequencyData(dataArray);
      const sum = dataArray.reduce((acc, v) => acc + v, 0);
      const avg = sum / (bufferLength || 1);
      const normalized = Math.min(1, Math.max(0, avg / 128));
      onVolumeChange(normalized);
    } catch {}
    rafId = requestAnimationFrame(draw);
  };

  source.onended = () => {
    try { cancelAnimationFrame(rafId); } catch {}
    try { onVolumeChange(0); } catch {}
    try { onEnd?.(); } catch {}
    try { audioContext.close(); } catch {}
  };

  source.start(0);
  draw();

  // Return the source to allow callers to stop if needed
  return source as unknown as HTMLAudioElement;
}

// Plays audio data from an ArrayBuffer via an HTMLAudioElement for robust mobile compatibility.
export function playAudioData(audioData: ArrayBuffer): { audio: HTMLAudioElement; done: Promise<void> } {
  const audio = document.getElementById('tts-player') as HTMLAudioElement | null;
  if (!audio) throw new Error('Persistent audio element #tts-player not found');

  const blob = new Blob([audioData], { type: 'audio/webm' });
  const url = URL.createObjectURL(blob);
  audio.src = url;

  const done = new Promise<void>((resolve, reject) => {
    audio.onended = () => {
      try { URL.revokeObjectURL(url); } catch {}
      resolve();
    };
    audio.onerror = (err) => {
      try { URL.revokeObjectURL(url); } catch {}
      console.error('Error playing audio:', err);
      reject(err as any);
    };
  });

  try {
    const p = audio.play();
    if (p && typeof (p as any).catch === 'function') (p as any).catch(() => {});
  } catch {}

  return { audio, done };
}
