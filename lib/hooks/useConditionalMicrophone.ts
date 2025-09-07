// In hooks/useConditionalMicrophone.ts

import { useCallback, useRef, useState } from 'react';
import { MicVAD } from '@ricky0123/vad-web';

function isMobile(): boolean {
  if (typeof navigator === 'undefined') return false;
  return /Mobi/i.test(navigator.userAgent || '');
}

// For mobile: callback receives a complete encoded utterance as a Blob
export function useConditionalMicrophone(onUtterance: (blob: Blob) => void) {
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
  const skipFinalFlushRef = useRef(false);
  // Throttled debug logging for frame-level metrics
  const lastLogAtRef = useRef(0);
  // Desktop VAD instance
  const vadRef = useRef<any | null>(null);

  const start = useCallback(async () => {
    if (isListening) return;

    if (isMobile()) {
      // Mobile path: AudioWorklet for reliable real-time capture
      const AC: any = (window as any).AudioContext || (window as any).webkitAudioContext;
      if (!AC) throw new Error('AudioContext not supported');
      if (!ctxRef.current) ctxRef.current = new AC({ latencyHint: 'interactive' } as any);
      const ctx = ctxRef.current!;
      if (ctx.state === 'suspended') await ctx.resume();

      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      streamRef.current = stream;

      await ctx.audioWorklet.addModule('/microphoneWorklet.js');
      const worklet = new AudioWorkletNode(ctx, 'microphone-processor');
      // Create a destination node to feed a MediaRecorder for encoding
      const dest = ctx.createMediaStreamDestination();
      encoderSourceRef.current = dest;
      // Choose a supported MIME type: prefer webm, fallback to mp4 for Safari/iOS
      let mimeType: string | undefined = undefined;
      try {
        const MR: any = (window as any).MediaRecorder;
        if (MR && typeof MR.isTypeSupported === 'function') {
          if (MR.isTypeSupported('audio/webm')) mimeType = 'audio/webm';
          else if (MR.isTypeSupported('audio/mp4')) mimeType = 'audio/mp4';
        }
      } catch {}
      const mr = mimeType
        ? new MediaRecorder(dest.stream, { mimeType, audioBitsPerSecond: 16000 })
        : new MediaRecorder(dest.stream, { audioBitsPerSecond: 16000 });
      mediaRecorderRef.current = mr;
      encoderStreamRef.current = dest.stream;
      encodedChunksRef.current = [];
      console.log('[mic] Mobile path init: mimeType=%s', mimeType || '(default)');
      mr.ondataavailable = (e) => {
        // Forward smaller, frequent chunks (2s) rather than whole utterances
        if (e.data && e.data.size) {
          console.debug(
            '[mic] ondataavailable (mobile): size=%d type=%s',
            e.data.size,
            e.data.type,
          );
          try {
            onUtterance(e.data);
          } catch {}
        }
      };
      mr.onstop = () => {
        try {
          if (!skipFinalFlushRef.current) {
            // We already streamed chunks via ondataavailable; no final aggregated flush needed
            console.log('[mic] MediaRecorder stopped (mobile): streamed chunks during recording');
          } else {
            console.log('[mic] Skipping final flush on stop (mobile path)');
          }
        } finally {
          encodedChunksRef.current = [];
          skipFinalFlushRef.current = false;
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
        for (let i = 0; i < buf.length; i++) {
          const v = buf[i] ?? 0;
          sum += v * v;
        }
        const rms = Math.sqrt(sum / (buf.length || 1));
        const speaking = rms > RMS_THRESHOLD;

        chunkQueueRef.current.push(buf);
        framesCount += 1;

        // Throttled per-frame debug
        const now = typeof performance !== 'undefined' ? performance.now() : Date.now();
        if (!lastLogAtRef.current || now - lastLogAtRef.current > 200) {
          lastLogAtRef.current = now;
          console.debug(
            '[mic] frame=%d len=%d rms=%s speak=%s silence=%d/%d',
            framesCount,
            buf.length,
            rms.toFixed(4),
            speaking,
            silenceCounterRef.current,
            SILENCE_FRAMES_TO_END,
          );
        }

        if (!speakingRef.current && speaking) {
          // Start utterance
          speakingRef.current = true;
          silenceCounterRef.current = 0;
          startedAt = performance.now();
          try {
            // 2s timeslice to get smaller, frequent chunks
            mr.start(2000);
            console.log('[mic] Utterance start: frame=%d, rms=%s', framesCount, rms.toFixed(4));
          } catch (e) {
            console.warn('[mic] mr.start() failed', e);
          }
        } else if (speakingRef.current) {
          if (speaking) {
            silenceCounterRef.current = 0;
          } else {
            silenceCounterRef.current += 1;
            if (silenceCounterRef.current >= SILENCE_FRAMES_TO_END) {
              // End utterance
              speakingRef.current = false;
              silenceCounterRef.current = 0;
              try {
                const dur = Math.round(performance.now() - startedAt || 0);
                console.log(
                  '[mic] Utterance end: duration=%dms, frames=%d -> mr.stop()',
                  dur,
                  framesCount,
                );
                mr.stop();
              } catch (e) {
                console.warn('[mic] mr.stop() failed', e);
              }
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

    // Desktop path: integrate VAD to segment speech and control MediaRecorder
    const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
    streamRef.current = stream;

    // Choose supported MIME on desktop as well
    let mimeType: string | undefined = undefined;
    try {
      const MR: any = (window as any).MediaRecorder;
      if (MR && typeof MR.isTypeSupported === 'function') {
        if (MR.isTypeSupported('audio/webm')) mimeType = 'audio/webm';
        else if (MR.isTypeSupported('audio/mp4')) mimeType = 'audio/mp4';
      }
    } catch {}

    const mr = mimeType
      ? new MediaRecorder(stream, { mimeType, audioBitsPerSecond: 16000 })
      : new MediaRecorder(stream, { audioBitsPerSecond: 16000 });
    mediaRecorderRef.current = mr;
    let chunks: BlobPart[] = [];

    mr.ondataavailable = (e) => {
      // Forward smaller, frequent chunks (2s) rather than whole utterances
      if (e.data && e.data.size > 0) {
        try {
          onUtterance(e.data);
        } catch {}
      }
    };
    mr.onstop = () => {
      try {
        if (!skipFinalFlushRef.current) {
          // We already streamed chunks during recording; no final aggregated flush needed
          console.log('[mic] Desktop MediaRecorder stopped: streamed chunks during recording');
        } else {
          console.log('[mic] Skipping final flush on stop (desktop path)');
        }
      } finally {
        chunks = [];
        skipFinalFlushRef.current = false;
      }
    };

    // Initialize VAD (let the library acquire the mic internally)
    const vad = await MicVAD.new({
      // timing in milliseconds (replaces *Frames*)
      minSpeechMs: 200, // ~0.2s for quicker start
      redemptionMs: 500, // grace period after speech ends
      positiveSpeechThreshold: 0.6,
      negativeSpeechThreshold: 0.35,
      onSpeechStart: () => {
        try {
          if (mr.state !== 'recording') {
            chunks = [];
            // 2s timeslice to get smaller, frequent chunks
            mr.start(2000);
            console.log('[mic] VAD onSpeechStart -> mr.start()');
          }
        } catch (e) {
          console.warn('[mic] mr.start() failed', e);
        }
      },
      onSpeechEnd: () => {
        try {
          if (mr.state === 'recording') {
            console.log('[mic] VAD onSpeechEnd -> mr.stop()');
            mr.stop();
          }
        } catch (e) {
          console.warn('[mic] mr.stop() failed', e);
        }
      },
    });

    vadRef.current = vad;
    await vad.start();
    setIsListening(true);
  }, [isListening, onUtterance]);

  const stop = useCallback((opts?: { skipFinalFlush?: boolean }) => {
    skipFinalFlushRef.current = !!opts?.skipFinalFlush;
    try {
      mediaRecorderRef.current?.stop();
    } catch {}
    mediaRecorderRef.current = null;

    // Destroy desktop VAD if active
    if (vadRef.current) {
      try {
        vadRef.current.destroy();
      } catch {}
      vadRef.current = null;
    }

    if (sourceNodeRef.current) {
      try {
        sourceNodeRef.current.disconnect();
      } catch {}
      sourceNodeRef.current = null;
    }

    if (workletNodeRef.current) {
      try {
        workletNodeRef.current.port.onmessage = null as any;
      } catch {}
      try {
        workletNodeRef.current.disconnect();
      } catch {}
      workletNodeRef.current = null;
    }

    const stream = streamRef.current;
    if (stream) {
      stream.getTracks().forEach((t) => {
        try {
          t.stop();
        } catch {}
      });
      streamRef.current = null;
    }

    if (ctxRef.current) {
      try {
        ctxRef.current.close();
      } catch {}
      ctxRef.current = null;
    }

    setIsListening(false);
  }, []);

  return { start, stop, isListening } as const;
}
