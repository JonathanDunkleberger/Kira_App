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

/** Static emotion→expression map (used in init flush + expression effect) */
const EMOTION_MAP_STATIC: Record<string, string | null> = {
  neutral: null,
  happy: null,
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
  const modelStableRef = useRef(false);
  const modelStableTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const pendingEmotion = useRef<string | null>(null);
  const pendingAccessories = useRef<string[]>([]);
  const webglCrashCount = useRef(0);
  const pixiCreatedAt = useRef(0); // timestamp for crash diagnostics
  const pixiResolutionRef = useRef(1); // store actual PIXI resolution for positioning math
  const baseScaleRef = useRef(0);
  const baseYRef = useRef(0);
  const lastPinchDistance = useRef<number | null>(null);
  const [zoomLevel, setZoomLevel] = useState(1.0);
  const zoomLevelRef = useRef(1.0);
  const onModelReadyRef = useRef(onModelReady);
  onModelReadyRef.current = onModelReady;
  const onLoadErrorRef = useRef(onLoadError);
  onLoadErrorRef.current = onLoadError;
  const [modelReady, setModelReady] = useState(false);

  // Initialize PixiJS app + load model (runs once on mount)
  useEffect(() => {
    if (!containerRef.current || initializedRef.current) return;

    // Guard: destroy any orphaned PIXI app from a previous mount (React strict mode)
    if (appRef.current) {
      console.warn("[Live2D] PIXI app already exists — destroying old one first");
      try {
        appRef.current.destroy(true, { children: true, texture: true, baseTexture: true });
      } catch {}
      appRef.current = null;
      modelRef.current = null;
    }

    // Aggressively reclaim orphaned WebGL contexts (iOS limits to ~2 total)
    const container = containerRef.current;
    if (container) {
      const oldCanvases = container.querySelectorAll("canvas");
      oldCanvases.forEach(c => {
        try {
          const gl = c.getContext("webgl2") || c.getContext("webgl");
          if (gl && !gl.isContextLost()) {
            const ext = gl.getExtension("WEBGL_lose_context");
            if (ext) ext.loseContext();
          }
        } catch {}
        c.remove();
      });
    }

    initializedRef.current = true;

    let destroyed = false;
    let loadTimeoutId: ReturnType<typeof setTimeout> | null = null;

    (async () => {
      const loadStart = performance.now();
      try {
        const MODEL_LOAD_TIMEOUT = 30000;

        // Race the entire init against a timeout
        const timeoutPromise = new Promise<never>((_, reject) => {
          loadTimeoutId = setTimeout(
            () => reject(new Error(`Model load timeout (${MODEL_LOAD_TIMEOUT}ms)`)),
            MODEL_LOAD_TIMEOUT
          );
        });

        await Promise.race([_initLive2D(), timeoutPromise]);
      } catch (err) {
        if (!destroyed) {
          console.error(`[Live2D] Initialization failed after ${(performance.now() - loadStart).toFixed(0)}ms:`, err);
          onLoadErrorRef.current?.();
        }
      } finally {
        if (loadTimeoutId) clearTimeout(loadTimeoutId);
      }

      async function _initLive2D() {
        // 1. Load Cubism Core SDK (required by pixi-live2d-display)
        await loadCubismCore();

        // 2. Dynamic imports to avoid SSR — pixi-live2d-display touches window/document
        const PIXI = await import("pixi.js");
        // Set PIXI on window BEFORE importing pixi-live2d-display
        (window as any).PIXI = PIXI;

        const { Live2DModel } = await import("pixi-live2d-display/cubism4");

        if (destroyed || !containerRef.current) return;

        // Detect mobile for GPU budget decisions
        const isMobile = /iPhone|iPad|iPod|Android/i.test(navigator.userAgent);
        // Mobile: render at 1x to reduce GPU memory (the model still looks fine).
        // iOS: 1x (was 1.5 but the 33MB .moc3 needs all the headroom it can get).
        // Desktop: cap at 2x for retina sharpness.
        const resolution = isMobile ? 1 : Math.min(window.devicePixelRatio || 1, 2);

        let app: InstanceType<typeof PIXI.Application>;
        try {
          app = new PIXI.Application({
            backgroundAlpha: 0,
            resizeTo: containerRef.current,
            resolution,
            autoDensity: true,
            antialias: !isMobile,
            powerPreference: isMobile ? "low-power" : "default",
          });
          containerRef.current.appendChild(app.view as unknown as HTMLCanvasElement);
        } catch (pixiErr) {
          console.error("[Live2D] Failed to create PIXI app:", pixiErr);
          onLoadErrorRef.current?.();
          return;
        }
        appRef.current = app;
        pixiCreatedAt.current = Date.now();
        pixiResolutionRef.current = resolution;
        console.log(`[Live2D] PIXI app created (resolution: ${resolution}, antialias: ${!isMobile})`);

        // Listen for WebGL context loss (iOS kills GPU context under memory pressure)
        const canvas = app.view as unknown as HTMLCanvasElement;
        const gl = canvas.getContext("webgl2") || canvas.getContext("webgl");
        if (gl) {
          // Log GPU memory budget if available (WEBGL_debug_renderer_info)
          try {
            const ext = gl.getExtension("WEBGL_debug_renderer_info");
            if (ext) {
              console.log(`[Live2D] GPU: ${gl.getParameter(ext.UNMASKED_RENDERER_WEBGL)}`);
            }
          } catch {}
        }
        const handleContextLost = (e: Event) => {
          e.preventDefault();
          webglCrashCount.current++;
          const aliveSeconds = ((Date.now() - pixiCreatedAt.current) / 1000).toFixed(1);
          console.error(`[Live2D] WebGL context lost (crash #${webglCrashCount.current}) after ${aliveSeconds}s`);
          if (webglCrashCount.current >= 2) {
            console.error("[Live2D] Multiple WebGL crashes — staying on orb permanently");
          }
          // Stop the PIXI ticker to prevent further render attempts on a dead context
          try { app.ticker.stop(); } catch {}
          cancelAnimationFrame(animFrameRef.current);
          onLoadErrorRef.current?.();
        };
        canvas.addEventListener("webglcontextlost", handleContextLost);

        let model;
        try {
          const modelPath = isMobile
            ? "/worklets/models/Kira/kira.mobile.model3.json"
            : "/worklets/models/Kira/kira.model3.json";
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
        // Use the actual PIXI resolution (not device DPR) to convert renderer pixels → CSS pixels
        const containerWidth = app.renderer.width / resolution;
        const containerHeight = app.renderer.height / resolution;

        const scale = Math.min(
          containerWidth / model.width,
          containerHeight / model.height
        ) * 0.9;
        model.scale.set(scale);
        model.x = containerWidth / 2;
        model.y = containerHeight * 0.52;
        model.anchor.set(0.5, 0.5);

        // Store base positioning for zoom math
        baseScaleRef.current = scale;
        baseYRef.current = containerHeight * 0.52;

        // Eye tracking — eyes follow the cursor
        app.stage.interactive = true;
        app.stage.hitArea = app.renderer.screen;
        app.stage.on("pointermove", (e: any) => {
          model.focus(e.global.x, e.global.y);
        });

        modelRef.current = model;
        const loadMs = (performance.now() - loadStart).toFixed(0);
        console.log(`[Live2D] Model loaded successfully in ${loadMs}ms`);

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
              console.log(`[Live2D] Model ready — revealing (total ${(performance.now() - loadStart).toFixed(0)}ms)`);

              // Delay expressions/accessories for 2s to let GPU settle
              modelStableTimer.current = setTimeout(() => {
                modelStableRef.current = true;
                console.log("[Live2D] Model stable — expressions/accessories enabled");

                // Flush any queued emotion
                if (pendingEmotion.current && modelRef.current) {
                  const expr = pendingEmotion.current;
                  pendingEmotion.current = null;
                  try {
                    const mapped = EMOTION_MAP_STATIC[expr];
                    if (mapped) {
                      modelRef.current.expression(mapped);
                      console.log(`[Live2D] Flushed queued expression: ${mapped}`);
                    }
                  } catch {}
                }

                // Flush any queued accessories
                if (pendingAccessories.current.length > 0 && modelRef.current) {
                  pendingAccessories.current.forEach(acc => {
                    try {
                      modelRef.current.expression(acc);
                      activeAccessoriesRef.current.add(acc);
                      console.log(`[Live2D] Flushed queued accessory: ${acc}`);
                    } catch {}
                  });
                  pendingAccessories.current = [];
                }
              }, 2000);
            }
          });
        });
      } // end _initLive2D
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
          const res = pixiResolutionRef.current;
          const w = appRef.current.renderer.width / res;
          const h = appRef.current.renderer.height / res;

          // Recalculate base scale from the model's intrinsic size
          // (model.width/height already factor in scale, so divide it out first)
          const currentScale = modelRef.current.scale.x || 1;
          const rawWidth = modelRef.current.width / currentScale;
          const rawHeight = modelRef.current.height / currentScale;
          const newBaseScale = Math.min(w / rawWidth, h / rawHeight) * 0.9;
          baseScaleRef.current = newBaseScale;
          baseYRef.current = h * 0.52;

          const z = zoomLevelRef.current;
          modelRef.current.scale.set(newBaseScale * z);
          modelRef.current.x = w / 2;
          modelRef.current.y = baseYRef.current + (z - 1.0) * modelRef.current.height * 0.35;
        }
      }
    };
    window.addEventListener("resize", handleResize);

    return () => {
      destroyed = true;
      window.removeEventListener("resize", handleResize);
      cancelAnimationFrame(animFrameRef.current);
      if (modelRef.current) {
        try {
          modelRef.current.destroy({ children: true });
        } catch (e) {
          // ignore — model may already be destroyed
        }
        modelRef.current = null;
      }
      if (appRef.current) {
        // Explicitly lose WebGL context so iOS can reclaim the slot
        try {
          const canvas = appRef.current.view as unknown as HTMLCanvasElement;
          const gl = canvas.getContext("webgl2") || canvas.getContext("webgl");
          if (gl && !gl.isContextLost()) {
            const ext = gl.getExtension("WEBGL_lose_context");
            if (ext) ext.loseContext();
          }
        } catch {}
        try {
          appRef.current.destroy(true, { children: true, texture: true, baseTexture: true });
        } catch (e) {
          // ignore — app may already be destroyed
        }
        appRef.current = null;
      }
      initializedRef.current = false;
      modelStableRef.current = false;
      if (modelStableTimer.current) {
        clearTimeout(modelStableTimer.current);
        modelStableTimer.current = null;
      }
      pendingEmotion.current = null;
      pendingAccessories.current = [];
      setModelReady(false);
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

  // Use module-level emotion map
  const EMOTION_MAP = EMOTION_MAP_STATIC;

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

    // Queue if model not yet stable (prevents WebGL crash from early expression)
    if (!modelStableRef.current) {
      console.log(`[Live2D] Queuing emotion — model not yet stable: ${emotion}`);
      pendingEmotion.current = emotion;
      return;
    }

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

    // Queue if model not yet stable
    if (!modelStableRef.current && accessories) {
      const newItems = accessories.filter(a => !activeAccessoriesRef.current.has(a));
      if (newItems.length > 0) {
        console.log(`[Live2D] Queuing accessories — model not yet stable: ${newItems.join(", ")}`);
        pendingAccessories.current.push(...newItems);
      }
      return;
    }

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

  // Zoom: scroll wheel (desktop) + pinch (mobile)
  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;

    const MIN_ZOOM = 1.0;
    const MAX_ZOOM = 2.0;
    const ZOOM_STEP = 0.1;

    const handleWheel = (e: WheelEvent) => {
      e.preventDefault();
      setZoomLevel(prev => {
        const next = prev + (e.deltaY < 0 ? ZOOM_STEP : -ZOOM_STEP);
        return Math.min(MAX_ZOOM, Math.max(MIN_ZOOM, Math.round(next * 100) / 100));
      });
    };

    const handleTouchMove = (e: TouchEvent) => {
      if (e.touches.length !== 2) return;
      e.preventDefault();

      const dx = e.touches[0].clientX - e.touches[1].clientX;
      const dy = e.touches[0].clientY - e.touches[1].clientY;
      const distance = Math.sqrt(dx * dx + dy * dy);

      if (lastPinchDistance.current !== null) {
        const delta = distance - lastPinchDistance.current;
        setZoomLevel(prev => {
          const next = prev + delta * 0.005;
          return Math.min(MAX_ZOOM, Math.max(MIN_ZOOM, Math.round(next * 100) / 100));
        });
      }
      lastPinchDistance.current = distance;
    };

    const handleTouchEnd = () => {
      lastPinchDistance.current = null;
    };

    container.addEventListener("wheel", handleWheel, { passive: false });
    container.addEventListener("touchmove", handleTouchMove, { passive: false });
    container.addEventListener("touchend", handleTouchEnd);
    container.addEventListener("touchcancel", handleTouchEnd);

    return () => {
      container.removeEventListener("wheel", handleWheel);
      container.removeEventListener("touchmove", handleTouchMove);
      container.removeEventListener("touchend", handleTouchEnd);
      container.removeEventListener("touchcancel", handleTouchEnd);
    };
  }, []);

  // Apply zoom to model — scale up + shift down to keep face centered
  useEffect(() => {
    zoomLevelRef.current = zoomLevel;
    const model = modelRef.current;
    if (!model || !baseScaleRef.current) return;

    model.scale.set(baseScaleRef.current * zoomLevel);
    const yOffset = (zoomLevel - 1.0) * model.height * 0.35;
    model.y = baseYRef.current + yOffset;
  }, [zoomLevel]);

  return (
    <div style={{ width: "100%", height: "100%", maxWidth: "600px", maxHeight: "85vh", margin: "0 auto", position: "relative", overflow: "hidden" }}>
      <div
        ref={containerRef}
        style={{
          width: "100%",
          height: "100%",
          pointerEvents: "auto",
          overflow: "hidden",
          opacity: modelReady ? 1 : 0,
          transition: "opacity 0.3s ease-in",
        }}
      />
    </div>
  );
}
