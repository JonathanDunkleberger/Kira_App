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
  audio.onended = () => {
    URL.revokeObjectURL(url);
    onEnd?.();
  };
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
  gain.gain.exponentialRampToValueAtTime(0.00001, now + 0.2);
  osc.stop(now + 0.22);
}

// Analyze and play MP3 base64 audio, providing live volume updates.
export async function playAndAnalyzeAudio(
  b64: string,
  onVolumeChange: (volume: number) => void,
  onEnd?: () => void,
) {
  const AC: any = (window as any).AudioContext || (window as any).webkitAudioContext;
  if (!AC) {
    // Fallback: just play with HTMLAudio if Web Audio not available
    try {
      const a = await playMp3Base64(b64, onEnd);
      // No analysis; emit zero once
      try {
        onVolumeChange(0);
      } catch {}
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
    try {
      cancelAnimationFrame(rafId);
    } catch {}
    try {
      onVolumeChange(0);
    } catch {}
    try {
      onEnd?.();
    } catch {}
    try {
      audioContext.close();
    } catch {}
  };

  source.start(0);
  draw();

  // Return the source to allow callers to stop if needed
  return source as unknown as HTMLAudioElement;
}

// Plays audio data from an ArrayBuffer via an HTMLAudioElement for robust mobile compatibility.
export function playAudioData(audioData: ArrayBuffer): {
  audio: HTMLAudioElement;
  done: Promise<void>;
} {
  const a = document.getElementById('tts-player-a') as HTMLAudioElement | null;
  const b = document.getElementById('tts-player-b') as HTMLAudioElement | null;
  const audio = a || b;
  if (!audio) throw new Error('Persistent audio element #tts-player-a/#tts-player-b not found');

  const blob = new Blob([audioData], { type: 'audio/webm' });
  const url = URL.createObjectURL(blob);
  audio.src = url;

  const done = new Promise<void>((resolve, reject) => {
    audio.onended = () => {
      try {
        URL.revokeObjectURL(url);
      } catch {}
      resolve();
    };
    audio.onerror = (err) => {
      try {
        URL.revokeObjectURL(url);
      } catch {}
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

// Simple blob-based audio player: buffers chunks and plays a single blob when the stream ends.
export class AudioPlayer {
  // Double buffer elements
  private audioA: HTMLAudioElement;
  private audioB: HTMLAudioElement;
  private active: 'a' | 'b' = 'a';
  private preloaded: boolean = false;
  // Legacy single-blob buffer
  private desktopChunks: ArrayBuffer[] = [];
  private desktopContentType: string = 'audio/webm';
  // Segment queue playback state (URLs preloaded into the inactive element)
  private segmentQueue: Array<{ url: string; mime: string }> = [];
  private currentSegmentChunks: ArrayBuffer[] = [];
  private streamClosed = false;
  private isPlaying = false;
  private turnEndedCallback?: () => void;
  // In previous iterations we had an MSE-based player. We now use blob playback,
  // but keep a reset() to clear state and avoid stutter on some mobile browsers.

  constructor() {
    const a = document.getElementById('tts-player-a') as HTMLAudioElement | null;
    const b = document.getElementById('tts-player-b') as HTMLAudioElement | null;
    if (!a || !b)
      throw new Error('Persistent audio elements #tts-player-a/#tts-player-b not found');
    this.audioA = a;
    this.audioB = b;
    // Initialize chunk buffer
    this.desktopChunks = [];
    this.installOnEndedHandler();
  }

  appendChunk(chunk: ArrayBuffer) {
    this.desktopChunks.push(chunk);
  }

  async play() {
    try {
      await this.getActive().play();
    } catch (e) {
      // Best-effort, some browsers require user gesture
      try {
        (this.getActive() as any).play?.();
      } catch {}
    }
  }

  onEnded(callback: () => void) {
    this.turnEndedCallback = callback;
  }

  async endStream() {
    if (!this.desktopChunks.length) return;
    const merged = mergeArrayBuffers(this.desktopChunks);
    this.desktopChunks = [];
    const blob = new Blob([merged], { type: this.desktopContentType || 'audio/webm' });
    const url = URL.createObjectURL(blob);
    this.getActive().src = url;
    try {
      await this.play();
    } finally {
      // Release URL after playback ends via onEnded cleanup
    }
  }

  // Reset player state; on current blob-based path this revokes any blob URL,
  // clears buffered chunks, and detaches the source so next play starts cleanly.
  public reset() {
    try {
      for (const el of [this.audioA, this.audioB]) {
        const src = el.src;
        if (src && typeof src === 'string' && src.startsWith('blob:')) {
          try {
            URL.revokeObjectURL(src);
          } catch {}
        }
        try {
          (el as any).pause?.();
        } catch {}
        el.src = '';
      }
      // Stop/pause just in case, then clear source
    } catch {}
    // Clear any accumulated chunks
    this.desktopChunks = [];
    // Revoke and clear any queued segments
    try {
      for (const item of this.segmentQueue) {
        try {
          const url = (item as any)?.url;
          if (url && typeof url === 'string' && url.startsWith('blob:')) URL.revokeObjectURL(url);
        } catch {}
      }
    } catch {}
    this.segmentQueue = [];
    this.currentSegmentChunks = [];
    this.streamClosed = false;
    this.isPlaying = false;
    this.active = 'a';
    this.preloaded = false;
  }

  // Segment-aware playback API (progressive queue)
  // Begin a new audio turn (e.g., on 'audio_start'). Resets player and sets MIME.
  public beginTurn(mime?: string) {
    try {
      this.reset();
    } catch {}
    if (mime) {
      try {
        (this as any).setContentType?.(mime);
      } catch {}
    }
    this.streamClosed = false;
  }

  // Mark that no more segments will be enqueued for this turn (e.g., on 'audio_end').
  public closeTurn() {
    this.streamClosed = true;
    // If nothing is currently playing, kick off playback if queue has items,
    // otherwise immediately signal turn end.
    if (!this.isPlaying) {
      if ((this.segmentQueue || []).length > 0) {
        // Try to start any queued segment immediately
        this.preloadIfIdle();
      } else {
        try {
          this.turnEndedCallback?.();
        } catch {}
      }
    }
  }

  // Start a new segment (e.g., sentence)
  public beginSegment() {
    this.currentSegmentChunks = [];
  }

  // Append binary audio chunk to the current segment
  public appendChunkToSegment(chunk: ArrayBuffer) {
    this.currentSegmentChunks.push(chunk);
  }

  // Finalize current segment and enqueue for playback. If idle, start immediately.
  public async endSegment() {
    const chunks: ArrayBuffer[] = this.currentSegmentChunks || [];
    if (!chunks.length) return;
    this.currentSegmentChunks = [];
    const merged = mergeArrayBuffers(chunks);
    const blob = new Blob([merged], { type: this.desktopContentType || 'audio/webm' });
    const url = URL.createObjectURL(blob);
    this.segmentQueue.push({ url, mime: this.desktopContentType });
    this.preloadIfIdle();
  }

  // Internal: install onended handler to auto-advance queue and fire turn end when done
  private installOnEndedHandler() {
    const handleEnded = () => {
      // Revoke the URL that just played from the formerly active element
      try {
        const justPlayed = this.getActive();
        const src = justPlayed.src;
        if (src && typeof src === 'string' && src.startsWith('blob:')) {
          URL.revokeObjectURL(src);
        }
      } catch {}
      // If the other buffer has been preloaded, swap immediately and play it
      const other = this.getInactive();
      const hasNext = !!other.src;
      if (hasNext) {
        // swap active flag first, then play to minimize any race
        this.active = this.active === 'a' ? 'b' : 'a';
        this.isPlaying = true;
        try {
          const p = other.play();
          if (p && typeof (p as any).catch === 'function') p.catch(() => {});
        } catch {}
        // Preload the subsequent segment into the now-inactive element
        this.preloadNextIntoInactive();
        return;
      }
      // No preloaded next; try to preload one now (in case it arrived late)
      this.preloadNextIntoInactive(() => {
        const late = this.getInactive();
        if (late.src) {
          this.active = this.active === 'a' ? 'b' : 'a';
          this.isPlaying = true;
          try {
            const p = late.play();
            if (p && typeof (p as any).catch === 'function') p.catch(() => {});
          } catch {}
          this.preloadNextIntoInactive();
          return;
        }
        // Truly no more items
        this.isPlaying = false;
        if (this.streamClosed) {
          try {
            this.turnEndedCallback?.();
          } catch {}
          try {
            this.reset();
          } catch {}
        }
      });
    };
    this.audioA.onended = handleEnded;
    this.audioB.onended = handleEnded;
  }

  // Preload the next queued item into the inactive element if possible.
  private preloadIfIdle() {
    // If nothing is playing, start by preloading inactive and then start active immediately
    if (!this.isPlaying) {
      // Move one item to inactive
      const next = this.segmentQueue.shift();
      if (next) {
        const inactive = this.getInactive();
        inactive.src = next.url;
        // Start playback on that element immediately by swapping
        this.active = this.active === 'a' ? 'b' : 'a';
        this.isPlaying = true;
        try {
          const p = inactive.play();
          if (p && typeof (p as any).catch === 'function') p.catch(() => {});
        } catch {}
        // Preload subsequent into the newly inactive
        this.preloadNextIntoInactive();
      }
    } else {
      // If already playing, ensure the other buffer is preloaded
      this.preloadNextIntoInactive();
    }
  }

  private preloadNextIntoInactive(onDone?: () => void) {
    const next = this.segmentQueue[0];
    if (!next) {
      onDone?.();
      return;
    }
    const inactive = this.getInactive();
    if (!inactive.src) {
      // Set src for instant start on swap
      inactive.src = next.url;
      // Remove it from queue now that it's assigned
      this.segmentQueue.shift();
    }
    onDone?.();
  }

  private getActive(): HTMLAudioElement {
    return this.active === 'a' ? this.audioA : this.audioB;
  }
  private getInactive(): HTMLAudioElement {
    return this.active === 'a' ? this.audioB : this.audioA;
  }
}

// Allow caller to set the content type used for non-MSE blob playback
// Useful when the server negotiates MP3/MP4 for iOS
// eslint-disable-next-line @typescript-eslint/no-unused-vars
(AudioPlayer as any).prototype.setContentType = function (mime: string) {
  if (mime && typeof mime === 'string') {
    (this as any).desktopContentType = mime;
  }
};

// Decide the preferred TTS container/codec for the current browser.
// Returns both the Azure format hint (via caller) and the MIME for the HTMLAudioElement blob.
export function preferredTtsFormat(): { fmt: 'webm' | 'mp3'; mime: string } {
  try {
    if (typeof document !== 'undefined') {
      const audio = document.createElement('audio');
      const canWebm = audio.canPlayType('audio/webm; codecs=opus');
      // Prefer WebM Opus when supported (Chrome/Edge/Firefox). Safari returns '' (unsupported).
      if (canWebm === 'probably' || canWebm === 'maybe') {
        return { fmt: 'webm', mime: 'audio/webm' };
      }
    }
  } catch {}
  // Fallback to MP3 (widely supported incl. Safari/iOS)
  return { fmt: 'mp3', mime: 'audio/mpeg' };
}
function mergeArrayBuffers(parts: ArrayBuffer[]): ArrayBuffer {
  const total = parts.reduce((n, b) => n + b.byteLength, 0);
  const out = new Uint8Array(total);
  let offset = 0;
  for (const p of parts) {
    out.set(new Uint8Array(p), offset);
    offset += p.byteLength;
  }
  return out.buffer;
}
