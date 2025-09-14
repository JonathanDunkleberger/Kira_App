import { useEffect, useRef, useState } from 'react';

export function useAudioCapture(enabled: boolean) {
  const [ready, setReady] = useState(false);
  const streamRef = useRef<MediaStream | null>(null);
  const ctxRef = useRef<AudioContext | null>(null);
  const sourceRef = useRef<MediaStreamAudioSourceNode | null>(null);
  const processorRef = useRef<ScriptProcessorNode | null>(null);
  const rmsRef = useRef<number>(0);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      if (!enabled) return;
      try {
        const stream = await navigator.mediaDevices.getUserMedia({
          audio: {
            echoCancellation: true,
            noiseSuppression: true,
            autoGainControl: true,
          },
        });
        if (cancelled) return;
        streamRef.current = stream;
        const Ctor: typeof AudioContext = window.AudioContext || (window as any).webkitAudioContext;
        const ctx = new Ctor();
        ctxRef.current = ctx;
        const src = ctx.createMediaStreamSource(stream);
        sourceRef.current = src;
        const proc = ctx.createScriptProcessor(4096, 1, 1);
        processorRef.current = proc;

        proc.onaudioprocess = (e) => {
          const data = e.inputBuffer.getChannelData(0);
          const d: Float32Array = data;
          let sum = 0;
          const len = d.length;
          // @ts-ignore -- d is a Float32Array, length stable
          for (let i = 0; i < len; i++) sum += d[i] * d[i];
          const rms = Math.sqrt(sum / len);
          rmsRef.current = rms;
          // TODO: send frames only when rms > threshold
        };
        src.connect(proc);
        // connect to a silent destination (avoid echo) using a GainNode 0
        const gain = ctx.createGain();
        gain.gain.value = 0;
        proc.connect(gain);
        gain.connect(ctx.destination);
        setReady(true);
      } catch (err) {
        console.warn('Audio capture failed', err);
      }
    })();
    return () => {
      cancelled = true;
      processorRef.current?.disconnect();
      sourceRef.current?.disconnect();
      ctxRef.current?.close();
      streamRef.current?.getTracks().forEach((t) => t.stop());
      setReady(false);
    };
  }, [enabled]);

  return { ready, rms: rmsRef.current };
}
