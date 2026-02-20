"use client";
import { useRef, useCallback, useState } from "react";

const CLIP_DURATION_MS = 30_000; // 30 seconds

export function useClipRecorder() {
  const mediaRecorderRef = useRef<MediaRecorder | null>(null);
  const recordedChunks = useRef<Blob[]>([]);
  const isRecording = useRef(false);
  const [isClipSaving, setIsClipSaving] = useState(false);
  const [clipUrl, setClipUrl] = useState<string | null>(null);
  const [clipMimeType, setClipMimeType] = useState<string>("video/webm");
  const canvasStreamRef = useRef<MediaStream | null>(null);
  const combinedStreamRef = useRef<MediaStream | null>(null);
  const restartTimerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const compositeCanvasRef = useRef<HTMLCanvasElement | null>(null);
  const compositeAnimFrameRef = useRef<number>(0);

  /**
   * Start the rolling buffer. Call this when the conversation starts.
   *
   * @param canvasElement - The Live2D canvas element
   * @param audioDestination - A MediaStreamAudioDestinationNode carrying Kira's TTS audio
   * @param backgroundVideo - Optional background video element to composite behind the Live2D canvas
   */
  const startRollingBuffer = useCallback(
    (
      canvasElement: HTMLCanvasElement,
      audioDestination: MediaStreamAudioDestinationNode,
      backgroundVideo?: HTMLVideoElement | null
    ) => {
      if (isRecording.current) return;

      let captureStream: MediaStream;

      if (backgroundVideo) {
        // Create a composite canvas that draws the background video + Live2D canvas
        // NOTE: The Live2D canvas MUST have preserveDrawingBuffer:true for drawImage to work
        const compositeCanvas = document.createElement("canvas");
        // Match the on-screen canvas dimensions (CSS pixels, not backing store)
        compositeCanvas.width = canvasElement.clientWidth || canvasElement.width || 1920;
        compositeCanvas.height = canvasElement.clientHeight || canvasElement.height || 1080;
        compositeCanvasRef.current = compositeCanvas;
        const ctx = compositeCanvas.getContext("2d", { willReadFrequently: false })!;

        const drawFrame = () => {
          const cw = compositeCanvas.width;
          const ch = compositeCanvas.height;

          // Clear frame
          ctx.clearRect(0, 0, cw, ch);

          // Draw background video first (cover-fit to match CSS object-fit: cover)
          if (backgroundVideo && !backgroundVideo.paused && backgroundVideo.readyState >= 2) {
            const vw = backgroundVideo.videoWidth || cw;
            const vh = backgroundVideo.videoHeight || ch;
            const scale = Math.max(cw / vw, ch / vh);
            const sw = vw * scale;
            const sh = vh * scale;
            const sx = (cw - sw) / 2;
            const sy = (ch - sh) / 2;
            ctx.globalAlpha = 0.85; // Match the CSS opacity
            ctx.drawImage(backgroundVideo, sx, sy, sw, sh);
            ctx.globalAlpha = 1.0;
          } else {
            // No video frame ready — fill with dark background
            ctx.fillStyle = "#0D1117";
            ctx.fillRect(0, 0, cw, ch);
          }

          // Draw Live2D canvas on top (preserveDrawingBuffer must be true on the WebGL context)
          try {
            ctx.drawImage(canvasElement, 0, 0, cw, ch);
          } catch {
            // Silently skip if canvas is lost (WebGL context loss)
          }

          compositeAnimFrameRef.current = requestAnimationFrame(drawFrame);
        };
        drawFrame();

        captureStream = compositeCanvas.captureStream(30);
      } else {
        // No background video — capture Live2D canvas directly (original behavior)
        captureStream = canvasElement.captureStream(30);
      }

      canvasStreamRef.current = captureStream;

      // Combine canvas video track + TTS audio track into one stream
      const videoTrack = canvasStreamRef.current.getVideoTracks()[0];
      const audioTrack = audioDestination.stream.getAudioTracks()[0];

      combinedStreamRef.current = new MediaStream();
      if (videoTrack) combinedStreamRef.current.addTrack(videoTrack);
      if (audioTrack) combinedStreamRef.current.addTrack(audioTrack);

      // Determine best supported format
      // Prefer MP4 (plays everywhere, especially iOS). Fall back to WebM for Chrome/Firefox.
      const mimeType = MediaRecorder.isTypeSupported("video/mp4")
        ? "video/mp4"
        : MediaRecorder.isTypeSupported("video/mp4; codecs=avc3")
          ? "video/mp4; codecs=avc3"
          : MediaRecorder.isTypeSupported("video/webm; codecs=vp8,opus")
            ? "video/webm; codecs=vp8,opus"
            : "video/webm";

      const startRecording = () => {
        recordedChunks.current = [];

        try {
          mediaRecorderRef.current = new MediaRecorder(
            combinedStreamRef.current!,
            {
              mimeType,
              videoBitsPerSecond: 2_500_000, // 2.5 Mbps — good quality, reasonable size
            }
          );

          mediaRecorderRef.current.ondataavailable = (event) => {
            if (event.data.size > 0) {
              recordedChunks.current.push(event.data);
            }
          };

          // Request data every second so we have granular chunks
          mediaRecorderRef.current.start(1000);
          isRecording.current = true;
        } catch (e) {
          console.error("[Clip] Failed to start MediaRecorder:", e);
        }
      };

      startRecording();

      // Rolling buffer: restart every 30 seconds to keep only recent content
      restartTimerRef.current = setInterval(() => {
        if (mediaRecorderRef.current?.state === "recording") {
          mediaRecorderRef.current.stop();
        }
        // Small delay to ensure stop completes before restarting
        setTimeout(startRecording, 100);
      }, CLIP_DURATION_MS);
    },
    []
  );

  /**
   * Save the current buffer as a clip. Call this when user taps "Clip".
   */
  const saveClip = useCallback(async (): Promise<string | null> => {
    setIsClipSaving(true);

    return new Promise((resolve) => {
      if (
        !mediaRecorderRef.current ||
        mediaRecorderRef.current.state !== "recording"
      ) {
        setIsClipSaving(false);
        resolve(null);
        return;
      }

      // Stop recording to flush final chunks
      mediaRecorderRef.current.onstop = () => {
        const mime =
          mediaRecorderRef.current?.mimeType || "video/webm";
        const blob = new Blob(recordedChunks.current, { type: mime });
        const url = URL.createObjectURL(blob);

        setClipUrl(url);
        setClipMimeType(mime);
        setIsClipSaving(false);

        // Haptic feedback on mobile
        if (navigator.vibrate) {
          navigator.vibrate(50);
        }

        resolve(url);

        // Restart recording for next potential clip
        // The rolling buffer interval handles this, but we kick-start immediately
        recordedChunks.current = [];
        try {
          if (combinedStreamRef.current) {
            mediaRecorderRef.current = new MediaRecorder(
              combinedStreamRef.current,
              {
                mimeType: mime,
                videoBitsPerSecond: 2_500_000,
              }
            );
            mediaRecorderRef.current.ondataavailable = (event) => {
              if (event.data.size > 0) {
                recordedChunks.current.push(event.data);
              }
            };
            mediaRecorderRef.current.start(1000);
            isRecording.current = true;
          }
        } catch {
          // Non-fatal — rolling buffer interval will restart
        }
      };

      mediaRecorderRef.current.stop();
    });
  }, []);

  /**
   * Stop all recording. Call this when conversation ends.
   */
  const stopRollingBuffer = useCallback(() => {
    if (restartTimerRef.current) {
      clearInterval(restartTimerRef.current);
      restartTimerRef.current = null;
    }
    if (mediaRecorderRef.current?.state === "recording") {
      mediaRecorderRef.current.stop();
    }
    if (compositeAnimFrameRef.current) {
      cancelAnimationFrame(compositeAnimFrameRef.current);
      compositeAnimFrameRef.current = 0;
    }
    isRecording.current = false;
    canvasStreamRef.current = null;
    combinedStreamRef.current = null;
    compositeCanvasRef.current = null;
  }, []);

  /**
   * Trigger native share or download
   */
  const shareClip = useCallback(async () => {
    if (!clipUrl) return;

    const response = await fetch(clipUrl);
    const blob = await response.blob();
    const extension = blob.type.includes("mp4") ? "mp4" : "webm";
    const file = new File([blob], `kira-clip-${Date.now()}.${extension}`, {
      type: blob.type,
    });

    // Try native Web Share API first (works on iOS Safari, Android Chrome)
    if (navigator.share && navigator.canShare?.({ files: [file] })) {
      try {
        await navigator.share({
          files: [file],
          title: "Kira Clip",
          text: "Check out this conversation with Kira!",
        });
        return;
      } catch (e) {
        // User cancelled share or share failed — fall through to download
        if ((e as Error).name === "AbortError") return;
      }
    }

    // Fallback: direct download
    const a = document.createElement("a");
    a.href = clipUrl;
    a.download = `kira-clip-${Date.now()}.${extension}`;
    document.body.appendChild(a);
    a.click();
    a.remove();
  }, [clipUrl]);

  /**
   * Download the clip directly (desktop fallback)
   */
  const downloadClip = useCallback(async () => {
    if (!clipUrl) return;

    const response = await fetch(clipUrl);
    const blob = await response.blob();
    const extension = blob.type.includes("mp4") ? "mp4" : "webm";

    const a = document.createElement("a");
    a.href = clipUrl;
    a.download = `kira-clip-${Date.now()}.${extension}`;
    document.body.appendChild(a);
    a.click();
    a.remove();
  }, [clipUrl]);

  return {
    startRollingBuffer,
    stopRollingBuffer,
    saveClip,
    shareClip,
    downloadClip,
    isClipSaving,
    clipUrl,
    setClipUrl,
    clipMimeType,
  };
}
