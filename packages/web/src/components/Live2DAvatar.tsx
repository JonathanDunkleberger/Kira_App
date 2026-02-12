"use client";

import { useEffect, useRef, useState } from "react";

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
  accessories?: string[];
  onModelReady?: () => void;
  onLoadError?: () => void;
}

export default function Live2DAvatar({ isSpeaking, analyserNode, emotion, accessories, onModelReady, onLoadError }: Live2DAvatarProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const appRef = useRef<any>(null);
  const modelRef = useRef<any>(null);
  const animFrameRef = useRef<number>(0);
  const expressionTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const activeAccessoriesRef = useRef<Set<string>>(new Set());
  const initializedRef = useRef(false);
  const onModelReadyRef = useRef(onModelReady);
  onModelReadyRef.current = onModelReady;
  const onLoadErrorRef = useRef(onLoadError);
  onLoadErrorRef.current = onLoadError;
  const [modelReady, setModelReady] = useState(false);

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

        // Detect mobile — force DPR 1 to avoid GPU memory issues
        // (iPhones cap WebGL textures at 4096px; 8192 textures + 3x DPR = crash)
        const isMobile = /iPhone|iPad|iPod|Android/i.test(navigator.userAgent);

        let app: InstanceType<typeof PIXI.Application>;
        try {
          app = new PIXI.Application({
            backgroundAlpha: 0,
            resizeTo: containerRef.current,
            resolution: window.devicePixelRatio || 2,
            autoDensity: true,
            antialias: !isMobile,
          });
          containerRef.current.appendChild(app.view as unknown as HTMLCanvasElement);
        } catch (pixiErr) {
          console.error("[Live2D] Failed to create PIXI app:", pixiErr);
          onLoadErrorRef.current?.();
          return;
        }
        appRef.current = app;

        // Listen for WebGL context loss (iOS kills GPU context under memory pressure)
        const canvas = app.view as unknown as HTMLCanvasElement;
        const handleContextLost = (e: Event) => {
          e.preventDefault();
          console.error("[Live2D] WebGL context lost — falling back to orb");
          onLoadErrorRef.current?.();
        };
        canvas.addEventListener("webglcontextlost", handleContextLost);

        let model;
        try {
          const modelPath = isMobile
            ? "/worklets/models/Kira/suki%E9%85%B1.mobile.model3.json"
            : "/worklets/models/Kira/suki%E9%85%B1.model3.json";
          model = await Live2DModel.from(
            modelPath,
            { autoInteract: false }
          );
        } catch (modelErr) {
          console.error("[Live2D] Failed to load model:", modelErr);
          onLoadErrorRef.current?.();
          return;
        }

        if (destroyed) return;

        app.stage.addChild(model as any);

        // Framing: show head to mid-thigh, centered with breathing room
        const dpr = window.devicePixelRatio || 2;
        const containerWidth = app.renderer.width / dpr;
        const containerHeight = app.renderer.height / dpr;

        const scale = Math.min(
          containerWidth / model.width,
          containerHeight / model.height
        ) * 0.9;
        model.scale.set(scale);
        model.x = containerWidth / 2;
        model.y = containerHeight * 0.52;
        model.anchor.set(0.5, 0.5);

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

        // Wait 2 frames for the watermark parameter to take effect before showing
        requestAnimationFrame(() => {
          requestAnimationFrame(() => {
            if (!destroyed) {
              setModelReady(true);
              onModelReadyRef.current?.();
              console.log("[Live2D] Model ready — revealing");
            }
          });
        });
      } catch (err) {
        console.error("[Live2D] Failed to initialize:", err);
        onLoadErrorRef.current?.();
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
          modelRef.current.y = h * 0.52;
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

  // Lip sync with instant open + rapid multiplicative decay
  useEffect(() => {
    const model = modelRef.current;

    if (!isSpeaking || !analyserNode || !model) {
      // Close mouth when not speaking
      try {
        model?.internalModel?.coreModel?.setParameterValueById("ParamMouthOpenY", 0);
        model?.internalModel?.coreModel?.setParameterValueById("ParamMouthForm", 0.15);
      } catch {}
      cancelAnimationFrame(animFrameRef.current);
      return;
    }

    const dataArray = new Uint8Array(analyserNode.frequencyBinCount);
    let smoothedVolume = 0;

    function animateMouth() {
      if (!modelRef.current || !analyserNode) return;

      analyserNode.getByteFrequencyData(dataArray);

      // Sample speech frequency bins (roughly 100-1000Hz range)
      // Skip bin 0 (DC offset), bins 1-5 carry most speech energy
      let sum = 0;
      const startBin = 1;
      const endBin = Math.min(6, dataArray.length);
      for (let i = startBin; i < endBin; i++) sum += dataArray[i];
      const rawVolume = sum / (endBin - startBin);

      // Normalize to 0-1 range
      const normalizedVolume = Math.min(rawVolume / 80, 1.0);

      // Two-speed: instant open, rapid multiplicative close
      if (normalizedVolume > smoothedVolume) {
        smoothedVolume = normalizedVolume; // Instant open — no smoothing up
      } else {
        smoothedVolume *= 0.6; // Rapid decay — drops to near-zero in ~3-4 frames
      }

      // Hard cutoff for near-silence
      if (smoothedVolume < 0.03) smoothedVolume = 0;

      // Square root curve — makes quiet speech more visible
      const mouthOpen = Math.sqrt(smoothedVolume);

      try {
        const core = modelRef.current.internalModel?.coreModel;
        if (core) {
          core.setParameterValueById("ParamMouthOpenY", mouthOpen);
          core.setParameterValueById("ParamMouthForm", 0.15 + mouthOpen * 0.2);
        }
      } catch {}

      animFrameRef.current = requestAnimationFrame(animateMouth);
    }

    animateMouth();

    return () => cancelAnimationFrame(animFrameRef.current);
  }, [isSpeaking, analyserNode]);

  // Emotion-to-Live2D expression mapping
  const EMOTION_MAP: Record<string, string | null> = {
    neutral: null,        // Clear all expressions
    happy: null,          // Natural state (smile via default params)
    excited: "star_eyes",
    love: "heart_eyes",
    blush: "blush",
    sad: "tears",
    angry: "angry",
    playful: "tongue_out",
    thinking: "dazed",
    speechless: "speechless",
    eyeroll: "eye_roll",
    sleepy: "sleeping",
  };

  /**
   * Properly reset Live2D expressions by clearing the expression manager state.
   * model.expression() with no args cycles to the NEXT expression in the list
   * (triggering random accessory expressions), so we must clear explicitly.
   */
  function resetExpression(model: any) {
    try {
      const mgr = model.internalModel?.motionManager?.expressionManager;
      if (mgr) {
        // Clear the currently playing expression
        if (mgr._expressions) {
          mgr._expressions.forEach((expr: any) => {
            if (expr && typeof expr.weight !== "undefined") {
              expr.weight = 0;
            }
          });
        }
        // Null out the tracked current expression
        if ("_currentExpression" in mgr) mgr._currentExpression = null;
        if ("currentExpression" in mgr) mgr.currentExpression = null;
        if ("_expressionIndex" in mgr) mgr._expressionIndex = -1;
        if ("expressionIndex" in mgr) mgr.expressionIndex = -1;
        console.log("[Live2D] Expression cleared via manager");
      }
    } catch (err) {
      console.warn("[Live2D] Failed to reset expression:", err);
    }

    // Re-apply active accessories (they must persist through emotion resets)
    Array.from(activeAccessoriesRef.current).forEach(acc => {
      try {
        model.expression(acc);
      } catch (err) {
        // ignore — accessory may not exist
      }
    });
  }

  // Watch for expression changes
  useEffect(() => {
    const model = modelRef.current;
    if (!model || !emotion) return;

    // Clear any pending reset
    if (expressionTimeoutRef.current) {
      clearTimeout(expressionTimeoutRef.current);
      expressionTimeoutRef.current = null;
    }

    const expressionName = EMOTION_MAP[emotion];

    if (expressionName) {
      // Trigger the expression
      try {
        model.expression(expressionName);
        console.log(`[Live2D] Expression: ${expressionName} (emotion: ${emotion})`);
      } catch (err) {
        console.warn(`[Live2D] Failed to set expression: ${expressionName}`, err);
      }

      // Auto-reset to neutral after 4 seconds
      expressionTimeoutRef.current = setTimeout(() => {
        resetExpression(model);
      }, 4000);
    } else {
      // neutral/happy — clear any active expression
      resetExpression(model);
    }
  }, [emotion]);

  // Watch for accessory changes — accessories persist (unlike emotions which flash)
  useEffect(() => {
    const model = modelRef.current;
    if (!model) return;

    if (accessories) {
      const newSet = new Set(accessories);

      // Turn ON new accessories
      Array.from(newSet).forEach(acc => {
        if (!activeAccessoriesRef.current.has(acc)) {
          try {
            model.expression(acc);
            console.log(`[Live2D] Accessory ON: ${acc}`);
          } catch (err) {
            console.warn(`[Live2D] Failed to apply accessory: ${acc}`, err);
          }
        }
      });

      activeAccessoriesRef.current = newSet;
    }
  }, [accessories]);

  // Clean up expression timeout on unmount
  useEffect(() => {
    return () => {
      if (expressionTimeoutRef.current) {
        clearTimeout(expressionTimeoutRef.current);
      }
    };
  }, []);

  return (
    <div style={{ width: "100%", height: "100%", maxWidth: "600px", maxHeight: "85vh", margin: "0 auto", position: "relative" }}>
      <div
        ref={containerRef}
        style={{
          width: "100%",
          height: "100%",
          pointerEvents: "auto",
          opacity: modelReady ? 1 : 0,
          transition: "opacity 0.3s ease-in",
        }}
      />
    </div>
  );
}
