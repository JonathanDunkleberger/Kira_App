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

        // Scale to fit container
        const scale = Math.min(
          app.renderer.width / model.width,
          app.renderer.height / model.height
        ) * 0.85;
        model.scale.set(scale);
        model.x = app.renderer.width / 2;
        model.y = app.renderer.height * 0.55;
        model.anchor.set(0.5, 0.5);

        // Eye tracking — eyes follow the cursor
        app.stage.interactive = true;
        app.stage.hitArea = app.renderer.screen;
        app.stage.on("pointermove", (e: any) => {
          model.focus(e.global.x, e.global.y);
        });

        modelRef.current = model;
        console.log("[Live2D] Model loaded successfully");
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
          modelRef.current.x = containerRef.current.clientWidth / 2;
          modelRef.current.y = containerRef.current.clientHeight * 0.55;
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

  // Lip sync: drive ParamMouthOpenY from audio analyser
  useEffect(() => {
    const model = modelRef.current;

    if (!isSpeaking || !analyserNode || !model) {
      // Close mouth when not speaking
      try {
        model?.internalModel?.coreModel?.setParameterValueById("ParamMouthOpenY", 0);
      } catch {}
      cancelAnimationFrame(animFrameRef.current);
      return;
    }

    const dataArray = new Uint8Array(analyserNode.frequencyBinCount);

    function animateMouth() {
      if (!modelRef.current || !analyserNode) return;

      analyserNode.getByteFrequencyData(dataArray);

      // Calculate average volume from frequency data
      let sum = 0;
      for (let i = 0; i < dataArray.length; i++) sum += dataArray[i];
      const volume = sum / dataArray.length;

      // Map volume to mouth open (0.0 - 1.0)
      const mouthValue = Math.min(volume / 35, 1.0);

      try {
        const core = modelRef.current.internalModel?.coreModel;
        if (core) {
          core.setParameterValueById("ParamMouthOpenY", mouthValue);
          // Add slight smile when speaking
          core.setParameterValueById("ParamMouthForm", 0.3 + mouthValue * 0.2);
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
        position: "absolute",
        top: 0,
        left: 0,
        pointerEvents: "auto",
      }}
    />
  );
}
