// In hooks/useConditionalMicrophone.ts

import { useCallback, useRef, useState } from 'react';

function isMobile(): boolean {
  if (typeof navigator === 'undefined') return false;
  return /Mobi/i.test(navigator.userAgent || '');
}

// For mobile: callback receives a complete encoded utterance as a Blob
export function useConditionalMicrophone(
  onUtterance: (blob: Blob) => void,
) {
  const ctxRef = useRef<AudioContext | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const workletNodeRef = useRef<AudioWorkletNode | null>(null);
  const sourceNodeRef = useRef<MediaStreamAudioSourceNode | null>(null);
  const mediaRecorderRef = useRef<MediaRecorder | null>(null);
  const [isListening, setIsListening] = useState(false);
  // Fixed segmentation thresholds (tuned and no longer runtime-adjustable)
  const rmsThresholdRef = useRef(0.02);
  const silenceMsRef = useRef(500);
  // Mobile segmentation state
  const chunkQueueRef = useRef<Float32Array[]>([]);
  const silenceCounterRef = useRef(0);
  const speakingRef = useRef(false);
  const encodedChunksRef = useRef<BlobPart[]>([]);
  const encoderStreamRef = useRef<MediaStream | null>(null);
  const encoderSourceRef = useRef<MediaStreamAudioDestinationNode | null>(null);

  const start = useCallback(async () => {
    if (isListening) return;

    if (isMobile()) {
      // Mobile path: AudioWorklet for reliable real-time capture
  const AC: any = (window as any).AudioContext || (window as any).webkitAudioContext;
  if (!AC) throw new Error('AudioContext not supported');
  if (!ctxRef.current) ctxRef.current = new AC();
  const ctx = ctxRef.current!;
  if (ctx.state === 'suspended') await ctx.resume();

      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      streamRef.current = stream;

  await ctx.audioWorklet.addModule('/microphoneWorklet.js');
  const worklet = new AudioWorkletNode(ctx, 'microphone-processor');
      // Create a destination node to feed a MediaRecorder for encoding
      const dest = ctx.createMediaStreamDestination();
      encoderSourceRef.current = dest;
      const mr = new MediaRecorder(dest.stream, { mimeType: 'audio/webm' });
      mediaRecorderRef.current = mr;
      encoderStreamRef.current = dest.stream;
      encodedChunksRef.current = [];
      mr.ondataavailable = (e) => { if (e.data && e.data.size) encodedChunksRef.current.push(e.data); };
      mr.onstop = () => {
        try {
          const blob = new Blob(encodedChunksRef.current, { type: 'audio/webm' });
          if (blob.size) onUtterance(blob);
        } finally {
          encodedChunksRef.current = [];
        }
      };

      // Segmentation via RMS thresholding
      const FRAME_MS = 20; // 20ms frames
  const RMS_THRESHOLD = rmsThresholdRef.current;
  const SILENCE_FRAMES_TO_END = Math.round((silenceMsRef.current || 500) / FRAME_MS);
      let framesCount = 0;
      let startedAt = 0;

      worklet.port.onmessage = (ev: MessageEvent<ArrayBuffer>) => {
        const buf = new Float32Array(ev.data);
        // Compute RMS
        let sum = 0;
        for (let i = 0; i < buf.length; i++) { const v = buf[i]; sum += v * v; }
        const rms = Math.sqrt(sum / (buf.length || 1));
        const speaking = rms > RMS_THRESHOLD;

        chunkQueueRef.current.push(buf);
        framesCount += 1;

        if (!speakingRef.current && speaking) {
          // Start utterance
          speakingRef.current = true;
          silenceCounterRef.current = 0;
          startedAt = performance.now();
          try { mr.start(); } catch {}
        } else if (speakingRef.current) {
          if (speaking) {
            silenceCounterRef.current = 0;
          } else {
            silenceCounterRef.current += 1;
            if (silenceCounterRef.current >= SILENCE_FRAMES_TO_END) {
              // End utterance
              speakingRef.current = false;
              silenceCounterRef.current = 0;
              try { mr.stop(); } catch {}
              // Reset queue for next utterance
              chunkQueueRef.current = [];
              framesCount = 0;
            }
          }
        }
      };
  const source = ctx.createMediaStreamSource(stream);
      // Route audio to both worklet (for segmentation) and encoder destination
      source.connect(worklet);
      source.connect(dest);

      workletNodeRef.current = worklet;
      sourceNodeRef.current = source;
      setIsListening(true);
      return;
    }

    // Desktop path: use existing MediaRecorder-based logic
    const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
    streamRef.current = stream;
    const mr = new MediaRecorder(stream, { mimeType: 'audio/webm' });
    mediaRecorderRef.current = mr;
    const chunks: BlobPart[] = [];

    mr.ondataavailable = (e) => {
      if (e.data && e.data.size > 0) chunks.push(e.data);
    };
    mr.onstop = async () => {
      const blob = new Blob(chunks, { type: 'audio/webm' });
  try { onUtterance(blob); } catch {}
    };

    mr.start();
    setIsListening(true);
  }, [isListening, onUtterance]);

  const stop = useCallback(() => {
    try { mediaRecorderRef.current?.stop(); } catch {}
    mediaRecorderRef.current = null;

    if (sourceNodeRef.current) {
      try { sourceNodeRef.current.disconnect(); } catch {}
      sourceNodeRef.current = null;
    }

    if (workletNodeRef.current) {
      try { workletNodeRef.current.port.onmessage = null as any; } catch {}
      try { workletNodeRef.current.disconnect(); } catch {}
      workletNodeRef.current = null;
    }

    const stream = streamRef.current;
    if (stream) {
      stream.getTracks().forEach(t => { try { t.stop(); } catch {} });
      streamRef.current = null;
    }

    if (ctxRef.current) {
      try { ctxRef.current.close(); } catch {}
      ctxRef.current = null;
    }

    setIsListening(false);
  }, []);

  return { start, stop, isListening } as const;
}
