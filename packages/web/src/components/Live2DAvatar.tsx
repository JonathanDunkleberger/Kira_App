"use client";

import { useEffect, useRef } from "react";

// pixi-live2d-display requires PIXI on window before import.
// Dynamic import is handled below to avoid SSR issues.

/** Load the Cubism 4 Core SDK if not already present */
function loadCubismCore(): Promise<void> {
  return new Promise((resolve, reject) => {
    if ((window as any).Live2DCubismCore) {
      resolve();
      return;
    }
    const script = document.createElement("script");
    script.src = "https://cubism.live2d.com/sdk-web/cubismcore/live2dcubismcore.min.js";
    script.onload = () => {
      console.log("[Live2D] Cubism Core loaded");
      resolve();
    };
    script.onerror = () => reject(new Error("Failed to load Cubism Core SDK"));
    document.head.appendChild(script);
  });
}

interface Live2DAvatarProps {
  isSpeaking: boolean;
  analyserNode: AnalyserNode | null;
  emotion?: string | null;
}

export default function Live2DAvatar({ isSpeaking, analyserNode, emotion }: Live2DAvatarProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const appRef = useRef<any>(null);
  const modelRef = useRef<any>(null);
  const animFrameRef = useRef<number>(0);
  const prevEmotionRef = useRef<string | null>(null);
  const initializedRef = useRef(false);

  // Initialize PixiJS app + load model (runs once on mount)
  useEffect(() => {
    if (!containerRef.current || initializedRef.current) return;
    initializedRef.current = true;

    let destroyed = false;

    (async () => {
      try {
        // 1. Load Cubism Core SDK (required by pixi-live2d-display)
        await loadCubismCore();

        // 2. Dynamic imports to avoid SSR — pixi-live2d-display touches window/document
        const PIXI = await import("pixi.js");
        // Set PIXI on window BEFORE importing pixi-live2d-display
        (window as any).PIXI = PIXI;

        const { Live2DModel } = await import("pixi-live2d-display/cubism4");

        if (destroyed || !containerRef.current) return;

        const app = new PIXI.Application({
          backgroundAlpha: 0,
          resizeTo: containerRef.current,
          resolution: window.devicePixelRatio || 2,
          autoDensity: true,
          antialias: true,
        });
        containerRef.current.appendChild(app.view as unknown as HTMLCanvasElement);
        appRef.current = app;

        const model = await Live2DModel.from(
          "/worklets/models/Kira/suki%E9%85%B1.model3.json",
          { autoInteract: false }
        );

        if (destroyed) return;

        app.stage.addChild(model as any);

        // Framing: show head to mid-thigh, centered with breathing room
        const dpr = window.devicePixelRatio || 2;
        const containerWidth = app.renderer.width / dpr;
        const containerHeight = app.renderer.height / dpr;

        const scale = Math.min(
          containerWidth / model.width,
          containerHeight / model.height
        ) * 1.25;
        model.scale.set(scale);
        model.x = containerWidth / 2;
        model.y = containerHeight * 0.30;
        model.anchor.set(0.5, 0.25);

        // Eye tracking — eyes follow the cursor
        app.stage.interactive = true;
        app.stage.hitArea = app.renderer.screen;
        app.stage.on("pointermove", (e: any) => {
          model.focus(e.global.x, e.global.y);
        });

        modelRef.current = model;
        console.log("[Live2D] Model loaded successfully");

        // Hide the built-in watermark overlay.
        // Live2D resets parameters every frame, so we must override
        // Param155 on every tick. The original update method is patched
        // to force the watermark parameter after each internal update.
        try {
          const internalModel = model.internalModel;
          const origUpdate = internalModel.update.bind(internalModel);
          internalModel.update = function (dt: number, now: number) {
            origUpdate(dt, now);
            try {
              (internalModel.coreModel as any).setParameterValueById("Param155", 1);
            } catch {}
          };
          console.log("[Live2D] Watermark hide patch applied (Param155=1 per frame)");
        } catch (err2) {
          console.warn("[Live2D] Could not patch watermark hide:", err2);
        }
      } catch (err) {
        console.error("[Live2D] Failed to load model:", err);
      }
    })();

    // Handle resize
    const handleResize = () => {
      if (appRef.current?.renderer && containerRef.current) {
        appRef.current.renderer.resize(
          containerRef.current.clientWidth,
          containerRef.current.clientHeight
        );
        // Re-center model on resize
        if (modelRef.current) {
          const dpr = window.devicePixelRatio || 2;
          const w = appRef.current.renderer.width / dpr;
          const h = appRef.current.renderer.height / dpr;
          modelRef.current.x = w / 2;
          modelRef.current.y = h * 0.30;
        }
      }
    };
    window.addEventListener("resize", handleResize);

    return () => {
      destroyed = true;
      window.removeEventListener("resize", handleResize);
      cancelAnimationFrame(animFrameRef.current);
      if (appRef.current) {
        appRef.current.destroy(true, { children: true });
        appRef.current = null;
      }
      modelRef.current = null;
      initializedRef.current = false;
    };
  }, []);

  // Lip sync with smoothing and decay
  useEffect(() => {
    const model = modelRef.current;

    if (!isSpeaking || !analyserNode || !model) {
      // Smoothly close mouth when not speaking
      try {
        model?.internalModel?.coreModel?.setParameterValueById("ParamMouthOpenY", 0);
        model?.internalModel?.coreModel?.setParameterValueById("ParamMouthForm", 0.2);
      } catch {}
      cancelAnimationFrame(animFrameRef.current);
      return;
    }

    const dataArray = new Uint8Array(analyserNode.frequencyBinCount);
    let currentMouthValue = 0;

    function animateMouth() {
      if (!modelRef.current || !analyserNode) return;

      analyserNode.getByteFrequencyData(dataArray);

      // Focus on voice frequency range (85-500Hz typically for speech)
      // With fftSize=256 at 16kHz, each bin ≈ 62.5Hz
      // Bins 0-7 cover roughly 0-500Hz which captures speech fundamentals
      let sum = 0;
      const speechBins = Math.min(8, dataArray.length);
      for (let i = 0; i < speechBins; i++) sum += dataArray[i];
      const volume = sum / speechBins;

      // Target mouth value based on volume
      const targetMouth = Math.min(volume / 50, 1.0);

      // Smooth interpolation — opens fast, closes faster
      // This creates natural-looking syllable movement
      if (targetMouth > currentMouthValue) {
        // Opening: fast response (80% toward target per frame)
        currentMouthValue += (targetMouth - currentMouthValue) * 0.8;
      } else {
        // Closing: even faster decay (85% toward target per frame)
        // This is key — mouth snaps shut between syllables
        currentMouthValue += (targetMouth - currentMouthValue) * 0.85;
      }

      // Minimum threshold — below this, mouth is fully closed
      if (currentMouthValue < 0.05) currentMouthValue = 0;

      try {
        const core = modelRef.current.internalModel?.coreModel;
        if (core) {
          core.setParameterValueById("ParamMouthOpenY", currentMouthValue);
          // Slight smile that increases when talking
          core.setParameterValueById("ParamMouthForm", 0.2 + currentMouthValue * 0.15);
        }
      } catch {}

      animFrameRef.current = requestAnimationFrame(animateMouth);
    }

    animateMouth();

    return () => cancelAnimationFrame(animFrameRef.current);
  }, [isSpeaking, analyserNode]);

  // Expression changes
  useEffect(() => {
    const model = modelRef.current;
    if (!model || !emotion || emotion === prevEmotionRef.current) return;

    try {
      model.expression(emotion);
      prevEmotionRef.current = emotion;
      console.log(`[Live2D] Expression: ${emotion}`);
    } catch (err) {
      console.warn(`[Live2D] Expression "${emotion}" failed:`, err);
    }
  }, [emotion]);

  return (
    <div
      ref={containerRef}
      style={{
        width: "100%",
        height: "100%",
        maxWidth: "600px",
        maxHeight: "80vh",
        margin: "0 auto",
        position: "relative",
        pointerEvents: "auto",
      }}
    />
  );
}
