import { useEffect, useRef, useState } from "react";

interface UseSceneDetectionProps {
  videoRef: React.RefObject<HTMLVideoElement>;
  enabled: boolean;
  checkInterval?: number; // ms, default 2000
  threshold?: number; // percentage 0-100, default 15
}

export const useSceneDetection = ({
  videoRef,
  enabled,
  checkInterval = 2000,
  threshold = 15,
}: UseSceneDetectionProps) => {
  const [sceneBuffer, setSceneBuffer] = useState<string[]>([]);
  const lastFrameData = useRef<Uint8ClampedArray | null>(null);
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const fullCanvasRef = useRef<HTMLCanvasElement | null>(null);
  const intervalRef = useRef<NodeJS.Timeout | null>(null);

  // Reset buffer when disabled
  useEffect(() => {
    if (!enabled) {
      setSceneBuffer([]);
      lastFrameData.current = null;
    }
  }, [enabled]);

  useEffect(() => {
    if (!enabled || !videoRef.current) {
      if (intervalRef.current) clearInterval(intervalRef.current);
      return;
    }

    const detectSceneChange = () => {
      const video = videoRef.current;
      if (!video || video.paused || video.ended) return;

      if (!canvasRef.current) {
        canvasRef.current = document.createElement("canvas");
        canvasRef.current.width = 64;
        canvasRef.current.height = 64;
      }

      const ctx = canvasRef.current.getContext("2d", { willReadFrequently: true });
      if (!ctx) return;

      // Draw small frame for comparison
      ctx.drawImage(video, 0, 0, 64, 64);
      const currentFrameData = ctx.getImageData(0, 0, 64, 64).data;

      if (lastFrameData.current) {
        let diffPixels = 0;
        const totalPixels = 64 * 64;

        for (let i = 0; i < currentFrameData.length; i += 4) {
          const rDiff = Math.abs(currentFrameData[i] - lastFrameData.current[i]);
          const gDiff = Math.abs(currentFrameData[i + 1] - lastFrameData.current[i + 1]);
          const bDiff = Math.abs(currentFrameData[i + 2] - lastFrameData.current[i + 2]);

          // Simple difference threshold per pixel (sensitivity)
          if (rDiff + gDiff + bDiff > 100) {
            diffPixels++;
          }
        }

        const changePercentage = (diffPixels / totalPixels) * 100;

        if (changePercentage > threshold) {
          // Significant change detected! Capture full res frame.
          // console.log(`[SceneDetection] Change detected: ${changePercentage.toFixed(2)}%`);
          captureFullResFrame(video);
        }
      } else {
        // First run, just capture to start the buffer
        captureFullResFrame(video);
      }

      lastFrameData.current = currentFrameData;
    };

    const captureFullResFrame = (video: HTMLVideoElement) => {
      if (!fullCanvasRef.current) {
        fullCanvasRef.current = document.createElement("canvas");
      }
      const fullCanvas = fullCanvasRef.current;

      // Downscale to max 512px on longest side (matches GPT-4o "low" detail)
      const MAX_DIM = 512;
      const scale = Math.min(MAX_DIM / video.videoWidth, MAX_DIM / video.videoHeight, 1);
      fullCanvas.width = Math.round(video.videoWidth * scale);
      fullCanvas.height = Math.round(video.videoHeight * scale);

      const fullCtx = fullCanvas.getContext("2d");
      if (fullCtx) {
        fullCtx.drawImage(video, 0, 0, fullCanvas.width, fullCanvas.height);
        const base64 = fullCanvas.toDataURL("image/jpeg", 0.5);
        
        setSceneBuffer((prev) => {
          // Keep last 3 distinct frames
          const newBuffer = [...prev, base64];
          if (newBuffer.length > 3) {
            return newBuffer.slice(newBuffer.length - 3);
          }
          return newBuffer;
        });
      }
    };

    intervalRef.current = setInterval(detectSceneChange, checkInterval);

    return () => {
      if (intervalRef.current) clearInterval(intervalRef.current);
    };
  }, [enabled, videoRef, checkInterval, threshold]);

  return sceneBuffer;
};
