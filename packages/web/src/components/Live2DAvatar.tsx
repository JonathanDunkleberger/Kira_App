"use client";

import { useEffect, useRef, useState } from "react";
import { LipSyncEngine } from "../lib/LipSyncEngine";

// Silent in production unless ?debug is in the URL
const isDebug = typeof window !== 'undefined' && (process.env.NODE_ENV !== 'production' || window.location.search.includes('debug'));
function debugLog(...args: any[]) { if (isDebug) console.log(...args); }

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
      debugLog("[Live2D] Cubism Core loaded");
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
  thinking: null,
  speechless: "speechless",
  eyeroll: "eye_roll",
  sleepy: "sleeping",
  frustrated: "dark_face",
  confused: "spiral_eyes",
  surprised: "donut_mouth",
};

/** Per-emotion parameter overrides (brows, head tilt, mouth shape) */
const EMOTION_PARAMS: Record<string, Record<string, number>> = {
  sad: {
    "ParamBrowLY": -0.7,      // Brows droop down
    "ParamBrowRY": -0.7,
    "ParamBrowLForm": -0.5,   // Inner brows raise (worried shape)
    "ParamBrowRForm": -0.5,
    "ParamAngle8": -3,         // Slight head down
  },
  angry: {
    "ParamBrowLY": -0.3,      // Brows down
    "ParamBrowRY": -0.3,
    "ParamBrowLForm": 0.8,    // Brows furrowed inward
    "ParamBrowRForm": 0.8,
    "ParamAngle9": -2,         // Slight aggressive head tilt
  },
  thinking: {
    "ParamBrowLY": 0.5,       // One brow up
    "ParamBrowRY": -0.2,      // Other slightly down (asymmetric = thinking)
    "ParamAngle9": 4,          // Head tilt to side
    "ParamAngle8": 2,          // Slight head up
  },
  excited: {
    "ParamBrowLY": 0.8,       // Brows up!
    "ParamBrowRY": 0.8,
    "ParamAngle8": 2,          // Head up (enthusiastic)
  },
  love: {
    "ParamBrowLY": 0.4,       // Soft raised brows
    "ParamBrowRY": 0.4,
    "ParamAngle9": 3,          // Gentle head tilt
  },
  blush: {
    "ParamBrowLY": 0.3,
    "ParamBrowRY": 0.3,
    "ParamAngle8": -2,         // Shy head down
    "ParamAngle9": 3,          // Head tilt
  },
  happy: {
    "ParamBrowLY": 0.4,       // Slightly raised brows
    "ParamBrowRY": 0.4,
    "ParamEyeRSmile": 0.6,    // Eye smile
    "ParamEyeLSmile": 0.6,
  },
  sleepy: {
    "ParamBrowLY": -0.5,      // Drooping brows
    "ParamBrowRY": -0.5,
    "ParamAngle8": -4,         // Head drooping down
  },
  speechless: {
    "ParamBrowLY": 0.9,       // Brows way up (shock)
    "ParamBrowRY": 0.9,
  },
  eyeroll: {
    "ParamBrowLY": 0.3,
    "ParamBrowRY": 0.3,
    "ParamAngle9": 5,          // Exasperated head tilt
  },
  playful: {
    "ParamBrowLY": 0.5,       // One brow raised (mischievous)
    "ParamBrowRY": -0.1,
    "ParamAngle9": -3,         // Cheeky head tilt
  },
  frustrated: {
    "ParamBrowLY": -0.5,
    "ParamBrowRY": -0.5,
    "ParamBrowLForm": 0.7,
    "ParamBrowRForm": 0.7,
    "ParamAngle8": -3,         // Head down (menacing)
  },
  confused: {
    "ParamBrowLY": 0.6,       // One brow way up
    "ParamBrowRY": -0.3,      // Other down (asymmetric = confused)
    "ParamAngle9": 5,          // Head tilt
  },
  surprised: {
    "ParamBrowLY": 0.9,
    "ParamBrowRY": 0.9,
    "ParamAngle8": 2,          // Head back slightly
  },
};

interface Live2DAvatarProps {
  isSpeaking: boolean;
  analyserNode: AnalyserNode | null;
  emotion?: string | null;
  accessories?: string[];
  action?: string | null;
  onModelReady?: () => void;
  onLoadError?: () => void;
  onCanvasReady?: (canvas: HTMLCanvasElement) => void;
  isSceneActive?: boolean;
}

/** Per-accessory auto-remove durations (seconds). Default: 60s for unlisted items. */
const ACCESSORY_DURATIONS: Record<string, number> = {
  // Wearables — persist longer (user expects these to stay)
  glasses: 180,
  sunglasses: 180,
  headphones_on: 120,
  neck_headphones: 120,
  earbuds: 120,

  // Props — shorter (momentary actions)
  coffee: 45,
  tea: 45,
  boba: 45,
  energy_drink: 45,
  pocky: 30,

  // Default for anything not listed: 60s (handled in code below)
};

/** Accessory conflict groups — applying one removes conflicting ones */
const ACCESSORY_CONFLICTS: Record<string, string[]> = {
  headphones_on: ["neck_headphones", "earbuds"],
  neck_headphones: ["headphones_on", "earbuds"],
  earbuds: ["headphones_on", "neck_headphones"],
};

/** Session hairstyle cycle — rotates every 5 minutes */
const HAIRSTYLE_CYCLE = [
  null,              // Default look (no hairstyle expression)
  "low_twintails",   // Twin tails
  "clip_bangs",      // Bangs clipped back
];
const HAIRSTYLE_CYCLE_INTERVAL = 5 * 60 * 1000; // 5 minutes per style

/** Hair accessory IDs — managed exclusively by the cycle timer, blocked from other systems */
const HAIR_ACCESSORIES = new Set(["clip_bangs", "low_twintails"]);

/** Log JS heap usage (Chrome only — no-op on Safari/Firefox) */
function logMemory(label: string) {
  try {
    const mem = (performance as any).memory;
    if (mem) {
      debugLog(`[Memory] ${label} — Used: ${(mem.usedJSHeapSize / 1024 / 1024).toFixed(1)}MB, Total: ${(mem.totalJSHeapSize / 1024 / 1024).toFixed(1)}MB`);
    }
  } catch {}
}

export default function Live2DAvatar({ isSpeaking, analyserNode, emotion, accessories, action, onModelReady, onLoadError, onCanvasReady, isSceneActive }: Live2DAvatarProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const appRef = useRef<any>(null);
  const modelRef = useRef<any>(null);
  const canvasRef = useRef<HTMLCanvasElement | null>(null); // explicit canvas ref for cleanup
  const glRef = useRef<WebGLRenderingContext | WebGL2RenderingContext | null>(null); // stored GL context — NEVER call getContext during cleanup
  const contextLostHandlerRef = useRef<((e: Event) => void) | null>(null); // stored for removal
  const animFrameRef = useRef<number>(0);
  const expressionTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const expressionWaitingForSpeechEnd = useRef(false);
  const currentEmotionRef = useRef<string | null>(null);
  const activeAccessoriesRef = useRef<Set<string>>(new Set());
  const initializedRef = useRef(false);
  const modelStableRef = useRef(false);
  const modelStableTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const pendingEmotion = useRef<string | null>(null);
  const pendingAccessories = useRef<string[]>([]);
  const actionTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const activeActionRef = useRef<string | null>(null);
  const accessoryTimeoutRefs = useRef<Map<string, ReturnType<typeof setTimeout>>>(new Map());
  const webglCrashCount = useRef(0);
  const pixiCreatedAt = useRef(0); // timestamp for crash diagnostics
  const pixiResolutionRef = useRef(1); // store actual PIXI resolution for positioning math
  const baseScaleRef = useRef(0);
  const baseYRef = useRef(0);
  const lastPinchDistance = useRef<number | null>(null);
  const [zoomLevel, setZoomLevel] = useState(1.25);
  const zoomLevelRef = useRef(1.25);
  const onModelReadyRef = useRef(onModelReady);
  onModelReadyRef.current = onModelReady;
  const onLoadErrorRef = useRef(onLoadError);
  onLoadErrorRef.current = onLoadError;
  const onCanvasReadyRef = useRef(onCanvasReady);
  onCanvasReadyRef.current = onCanvasReady;
  const [modelReady, setModelReady] = useState(false);

  // Emotion blending — smoothly interpolate param overrides each frame
  const targetEmotionParams = useRef<Record<string, number>>({});
  const currentEmotionParams = useRef<Record<string, number>>({});
  const emotionBlendSpeed = useRef(0.08); // lerp factor per frame (~60fps → ~5 frame blend)

  // Lip sync engine — smooth mouth movement with attack/release dynamics
  const lipSyncEngine = useRef(new LipSyncEngine({
    attackSpeed: 0.45,    // Mouth opens quickly
    releaseSpeed: 0.10,   // Mouth closes gently (prevents snapping shut)
    noiseGate: 0.04,      // Ignore very quiet audio
    ampFloor: 0.06,       // Start opening mouth here
    ampCeiling: 0.45,     // Fully open at this amplitude
    maxMouthOpen: 0.8,    // Don't go above 80% open (looks more natural)
  }));

  // Hairstyle cycle — rotates through styles every 5 minutes
  const hairstyleIndexRef = useRef(0); // Always start with default look — first visible change at 5-min mark
  const hairstyleCycleTimerRef = useRef<ReturnType<typeof setInterval> | null>(null);

  /**
   * Full GPU + memory cleanup — must release ALL resources to prevent the
   * "second conversation crash" on mobile (iOS limits WebGL to ~2 contexts).
   *
   * Order matters:
   *   1. Stop render loop (no more GPU draw calls)
   *   2. Destroy Live2D model (releases model buffers)
   *   3. Remove webglcontextlost listener (prevent closure leak)
   *   4. Destroy PIXI app *while context is still valid* (so it can delete
   *      textures / framebuffers via real WebGL calls)
   *   5. Lose WebGL context (forces the browser to free GPU memory)
   *   6. Remove canvas from DOM
   *   7. Clear PIXI global texture caches (module-level singletons that survive unmount)
   *   8. Reset refs
   */
  const cleanupLive2D = useRef(() => {
    debugLog("[Live2D] Starting full cleanup…");
    logMemory("before cleanup");

    // 1. Stop render loop
    if (animFrameRef.current) {
      cancelAnimationFrame(animFrameRef.current);
      animFrameRef.current = 0;
    }

    // Clear timers
    if (modelStableTimer.current) {
      clearTimeout(modelStableTimer.current);
      modelStableTimer.current = null;
    }
    if (expressionTimeoutRef.current) {
      clearTimeout(expressionTimeoutRef.current);
      expressionTimeoutRef.current = null;
    }
    if (hairstyleCycleTimerRef.current) {
      clearInterval(hairstyleCycleTimerRef.current);
      hairstyleCycleTimerRef.current = null;
    }

    // 2. Destroy the Live2D model (frees model buffers + child display objects)
    if (modelRef.current) {
      try {
        modelRef.current.destroy({ children: true });
        debugLog("[Live2D] Model destroyed");
      } catch (e) {
        console.warn("[Live2D] Model destroy error (may already be destroyed):", e);
      }
      modelRef.current = null;
    }

    // 3. Remove the webglcontextlost listener (its closure captures the PIXI app,
    //    preventing GC if left attached)
    if (canvasRef.current && contextLostHandlerRef.current) {
      canvasRef.current.removeEventListener("webglcontextlost", contextLostHandlerRef.current);
      contextLostHandlerRef.current = null;
    }

    // 4. Destroy the PIXI Application *before* losing the context —
    //    PIXI needs a live context to call deleteTexture / deleteBuffer etc.
    if (appRef.current) {
      try {
        appRef.current.ticker.stop();
      } catch {}
      try {
        appRef.current.destroy(true, {
          children: true,
          texture: true,
          baseTexture: true,
        });
        debugLog("[Live2D] PIXI app destroyed");
      } catch (e) {
        console.warn("[Live2D] PIXI app destroy error:", e);
      }
      appRef.current = null;
    }

    // 5. Explicitly lose the WebGL context using the STORED reference.
    //    NEVER call getContext() here — on iOS it can CREATE a new context
    //    (counting against the ~2-3 context limit) instead of returning the old one.
    if (glRef.current) {
      try {
        if (!glRef.current.isContextLost()) {
          const ext = glRef.current.getExtension("WEBGL_lose_context");
          if (ext) {
            ext.loseContext();
            debugLog("[Live2D] WebGL context explicitly released");
          }
        }
      } catch {}
      glRef.current = null;
    }

    // 6. Remove canvas from DOM (PIXI's destroy(true) should do this,
    //    but belt-and-suspenders for the context-loss path)
    if (canvasRef.current && canvasRef.current.parentNode) {
      canvasRef.current.parentNode.removeChild(canvasRef.current);
    }
    canvasRef.current = null;

    // 7. Flush PIXI's global texture caches — these are module-level Maps
    //    that survive component unmount and hold GPU texture references.
    try {
      const PIXI = (window as any).PIXI;
      if (PIXI) {
        if (PIXI.utils?.TextureCache) {
          for (const key in PIXI.utils.TextureCache) {
            try { PIXI.utils.TextureCache[key].destroy(true); } catch {}
          }
        }
        if (PIXI.utils?.BaseTextureCache) {
          for (const key in PIXI.utils.BaseTextureCache) {
            try { PIXI.utils.BaseTextureCache[key].destroy(); } catch {}
          }
        }
        debugLog("[Live2D] PIXI texture caches cleared");
      }
    } catch (e) {
      console.warn("[Live2D] Cache cleanup error:", e);
    }

    // 8. Reset all state refs
    initializedRef.current = false;
    modelStableRef.current = false;
    pendingEmotion.current = null;
    pendingAccessories.current = [];
    activeAccessoriesRef.current = new Set();
    setModelReady(false);

    // 9. Clear PIXI from window — the Live2D SDK reads from window.PIXI,
    //    and stale references from a previous instance can cause init failures.
    try {
      delete (window as any).PIXI;
    } catch {}

    logMemory("after cleanup");
    debugLog("[Live2D] Cleanup complete");
  });

  // Initialize PixiJS app + load model (runs once on mount)
  useEffect(() => {
    if (!containerRef.current || initializedRef.current) return;

    // Guard: destroy any orphaned PIXI app from a previous mount (React strict mode)
    if (appRef.current) {
      console.warn("[Live2D] PIXI app already exists — running full cleanup first");
      cleanupLive2D.current();
    }

    // Remove orphaned canvases from previous mounts (React strict mode).
    // Do NOT call getContext on them — on iOS that can CREATE a new context
    // and waste one of the ~2-3 available context slots.
    const container = containerRef.current;
    if (container) {
      const oldCanvases = container.querySelectorAll("canvas");
      oldCanvases.forEach(c => {
        c.remove();
        debugLog("[Live2D] Removed orphaned canvas");
      });
    }

    initializedRef.current = true;
    logMemory("before init");

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
        // Full native resolution — no cap. iPhone 12 gets 3x, desktop whatever the display supports.
        const resolution = window.devicePixelRatio || 1;

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
        // Store canvas ref for cleanup (PIXI.view is the <canvas>)
        canvasRef.current = app.view as unknown as HTMLCanvasElement;
        // Ensure canvas is CSS-transparent too (not just WebGL framebuffer)
        canvasRef.current.style.background = "transparent";
        pixiCreatedAt.current = Date.now();
        pixiResolutionRef.current = resolution;
        debugLog(`[Live2D] PIXI app created (resolution: ${resolution}, antialias: ${!isMobile})`);

        // Notify parent that the canvas is available (used by clip recorder)
        onCanvasReadyRef.current?.(canvasRef.current);

        // Listen for WebGL context loss (iOS kills GPU context under memory pressure)
        const canvas = canvasRef.current!;
        // Store the GL context NOW — never call getContext again (iOS context limit)
        const gl = canvas.getContext("webgl2") || canvas.getContext("webgl");
        glRef.current = gl;
        if (gl) {
          // Log GPU memory budget if available (WEBGL_debug_renderer_info)
          try {
            const ext = gl.getExtension("WEBGL_debug_renderer_info");
            if (ext) {
              debugLog(`[Live2D] GPU: ${gl.getParameter(ext.UNMASKED_RENDERER_WEBGL)}`);
            }
          } catch {}
        }
        const handleContextLost = (e: Event) => {
          e.preventDefault();
          webglCrashCount.current++;
          const aliveSeconds = ((Date.now() - pixiCreatedAt.current) / 1000).toFixed(1);
          console.error(`[Live2D] WebGL context lost (crash #${webglCrashCount.current}) after ${aliveSeconds}s`);
          logMemory("at context loss");
          if (webglCrashCount.current >= 2) {
            console.error("[Live2D] Multiple WebGL crashes — staying on orb permanently");
          }
          // Stop the PIXI ticker to prevent further render attempts on a dead context
          try { appRef.current?.ticker.stop(); } catch {}
          cancelAnimationFrame(animFrameRef.current);
          onLoadErrorRef.current?.();
        };
        // Store handler ref so cleanup can remove it (prevents closure leak)
        contextLostHandlerRef.current = handleContextLost;
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

        const scaleFactor = 0.9;
        const scale = Math.min(
          containerWidth / model.width,
          containerHeight / model.height
        ) * scaleFactor;
        model.scale.set(scale * zoomLevelRef.current);
        model.x = containerWidth / 2;
        const zoomYOffset = (zoomLevelRef.current - 1.0) * model.height * 0.35;
        const yPosition = containerHeight * (isMobile ? 0.59 : 0.56) + zoomYOffset;
        model.y = yPosition;
        model.anchor.set(0.5, 0.5);

        // Store base positioning for zoom math
        baseScaleRef.current = scale;
        baseYRef.current = yPosition;

        // Eye tracking — eyes follow the cursor
        app.stage.interactive = true;
        app.stage.hitArea = app.renderer.screen;
        app.stage.on("pointermove", (e: any) => {
          model.focus(e.global.x, e.global.y);
        });

        modelRef.current = model;
        const loadMs = (performance.now() - loadStart).toFixed(0);
        debugLog(`[Live2D] Model loaded successfully in ${loadMs}ms`);

        // --- Per-frame parameter overrides ---
        // We patch at the coreModel.update() level, which is called INSIDE
        // internalModel.update() AFTER physics has run but BEFORE mesh deformation.
        // Pipeline: motions → physics (writes ears) → coreModel.update() → mesh deform
        // By injecting our values before calling origCoreUpdate(), mesh deformation
        // uses OUR values — physics can no longer overwrite them.
        try {
          const internalModel = model.internalModel;
          const coreModel = internalModel.coreModel as any;

          // Log all param IDs once for future debugging
          try {
            const rawModel = coreModel._model;
            if (rawModel && rawModel.parameters) {
              const allKeys: string[] = [];
              for (let i = 0; i < rawModel.parameters.count; i++) {
                allKeys.push(rawModel.parameters.ids[i]);
              }
              debugLog("[Live2D] ALL PARAMS:", JSON.stringify(allKeys));
            }
          } catch {}

          // ─── DEBUG: Log available motion groups, parameters, and idle/breathing state ───
          try {
            // Motion groups
            const motionManager = internalModel.motionManager as any;
            console.log("═══════════════════════════════════════════════════════════");
            console.log("[Live2D DEBUG] MOTION MANAGER:", motionManager);
            console.log("[Live2D DEBUG] Motion definitions:", motionManager?.definitions);
            console.log("[Live2D DEBUG] Motion groups available:", motionManager?.definitions ? Object.keys(motionManager.definitions) : "none");
            
            // Check each motion group for its motions
            if (motionManager?.definitions) {
              for (const [group, motions] of Object.entries(motionManager.definitions)) {
                console.log(`[Live2D DEBUG] Motion group "${group}":`, motions);
              }
            }
            
            // Current motion state
            console.log("[Live2D DEBUG] Current motion state:", motionManager?.state);
            console.log("[Live2D DEBUG] Is idle motion playing?", motionManager?.state?.currentGroup === "Idle");
            
            // Expression manager
            const exprManager = motionManager?.expressionManager;
            console.log("[Live2D DEBUG] Expression manager:", exprManager);
            console.log("[Live2D DEBUG] Available expressions:", exprManager?.definitions?.map((d: any) => d.Name || d.name));
            
            // All parameters with min/max/default values
            const rawModel2 = coreModel._model;
            if (rawModel2?.parameters) {
              const params = rawModel2.parameters;
              console.log(`[Live2D DEBUG] Total parameter count: ${params.count}`);
              const paramDetails: { id: string; min: number; max: number; default: number; current: number }[] = [];
              let hasParamBreath = false;
              for (let i = 0; i < params.count; i++) {
                const id = params.ids[i];
                const detail = {
                  id,
                  min: params.minimumValues[i],
                  max: params.maximumValues[i],
                  default: params.defaultValues[i],
                  current: params.values[i],
                };
                paramDetails.push(detail);
                if (id === "ParamBreath") hasParamBreath = true;
              }
              console.table(paramDetails);
              console.log(`[Live2D DEBUG] ParamBreath exists: ${hasParamBreath}`);
              
              // Log common animation params
              const interestingParams = ["ParamBreath", "ParamAngle5", "ParamAngle4", "ParamAngle3",
                "ParamAngle7", "ParamAngle8", "ParamAngle9", "ParamAngle12", "ParamAngle13", "ParamAngle14",
                "ParamAngle15", "ParamAngle16", "ParamAngle17",
                "ParamEyeROpen", "ParamEyeLOpen", "ParamEyeBallX", "ParamEyeBallY",
                "ParamMouthOpenY", "ParamMouthForm", "ParamBrowLY", "ParamBrowRY"];
              console.log("[Live2D DEBUG] Key animation parameters:");
              for (const pid of interestingParams) {
                const found = paramDetails.find(p => p.id === pid);
                if (found) {
                  console.log(`  ${pid}: min=${found.min} max=${found.max} default=${found.default} current=${found.current}`);
                } else {
                  console.log(`  ${pid}: NOT FOUND`);
                }
              }
            }
            
            // Check if idle motion is auto-started by the SDK
            console.log("[Live2D DEBUG] motionManager.groups:", motionManager?.groups);
            console.log("[Live2D DEBUG] motionManager.motionGroups:", motionManager?.motionGroups);
            console.log("[Live2D DEBUG] motionManager._motionGroups:", motionManager?._motionGroups);
            
            // Check the settings/model settings for motion groups
            const settings = internalModel.settings as any;
            console.log("[Live2D DEBUG] Model settings:", settings);
            console.log("[Live2D DEBUG] Settings motions:", settings?.motions);
            console.log("[Live2D DEBUG] Settings groups:", settings?.groups);
            console.log("═══════════════════════════════════════════════════════════");
          } catch (debugErr) {
            console.warn("[Live2D DEBUG] Error logging model info:", debugErr);
          }
          // ─── END DEBUG ───

          // Patch coreModel.update — called INSIDE internalModel.update,
          // AFTER physics but the original does mesh deformation.
          const origCoreUpdate = coreModel.update.bind(coreModel);
          let frameCount = 0;

          coreModel.update = function () {
            frameCount++;
            const t = frameCount / 60;

            if (frameCount % 3600 === 1) {
              debugLog(`[Live2D] Per-frame patch running (frame ${frameCount})`);
            }

            try {
              // --- Watermark hide ---
              coreModel.setParameterValueById("Param155", 1);

              // --- Force ears + tail visible ---
              coreModel.setParameterValueById("Param157", 0);

              // --- Breathing (gentle sine wave, ~4.2s cycle) ---
              const breath = (Math.sin(t * 1.5) + 1) * 0.5;
              coreModel.setParameterValueById("ParamBreath", breath);

              // --- Idle body sway (subtle, organic) ---
              const bodyX = Math.sin(t * 0.4) * 2 + Math.sin(t * 0.7) * 1;
              const bodyY = Math.sin(t * 0.3) * 1.5;
              coreModel.setParameterValueById("ParamAngle15", bodyX);
              coreModel.setParameterValueById("ParamAngle16", bodyY);

              // --- Head micro-movements ---
              const headX = Math.sin(t * 0.5) * 1.5 + Math.sin(t * 1.1) * 0.5;
              const headY = Math.sin(t * 0.35) * 1 + Math.cos(t * 0.8) * 0.5;
              const headZ = Math.sin(t * 0.25) * 1;
              coreModel.setParameterValueById("ParamAngle7", headX);
              coreModel.setParameterValueById("ParamAngle8", headY);
              coreModel.setParameterValueById("ParamAngle9", headZ);

              // --- Ear animation (AFTER physics, BEFORE mesh deformation) ---
              // Physics writes to Param68-77 based on eye blinks, but we override
              // with our own animation here. These params MUST be set inside
              // coreModel.update (before origCoreUpdate) to survive the
              // physics→deformation pipeline.
              const earBase = Math.sin(t * 2.0) * 0.8;
              const earSlow = Math.sin(t * 0.8) * 1.5;
              const earBreath = breath * 0.5;

              // Right ear
              coreModel.setParameterValueById("Param68", earSlow + earBase + earBreath);
              coreModel.setParameterValueById("Param69", earBase * 0.7 + Math.sin(t * 2.3) * 0.5);
              coreModel.setParameterValueById("Param70", earSlow * 0.5 + Math.sin(t * 1.7) * 0.4);
              coreModel.setParameterValueById("Param74", earBase * 0.5);
              coreModel.setParameterValueById("Param75", Math.sin(t * 1.5) * 0.5);

              // Left ear (slightly offset phase for organic asymmetry)
              coreModel.setParameterValueById("Param71", earSlow + earBase * 0.9 + earBreath);
              coreModel.setParameterValueById("Param72", earBase * 0.6 + Math.sin(t * 2.5) * 0.5);
              coreModel.setParameterValueById("Param73", earSlow * 0.5 + Math.sin(t * 1.9) * 0.4);
              coreModel.setParameterValueById("Param76", earBase * 0.4);
              coreModel.setParameterValueById("Param77", Math.sin(t * 1.3) * 0.5);
            } catch {}

            // --- Smooth emotion param blending ---
            // Lerp currentEmotionParams toward targetEmotionParams each frame.
            // This prevents hard snaps when emotions change and blends smoothly with idle sway.
            try {
              const target = targetEmotionParams.current;
              const current = currentEmotionParams.current;
              const speed = emotionBlendSpeed.current;

              // Collect all param keys from both target and current
              const allKeys = Array.from(new Set([...Object.keys(target), ...Object.keys(current)]));
              for (const key of allKeys) {
                const targetVal = target[key] ?? 0; // missing from target = blend to 0
                const currentVal = current[key] ?? 0;
                const blended = currentVal + (targetVal - currentVal) * speed;
                // Snap to target if close enough (avoid infinite micro-lerp)
                current[key] = Math.abs(blended - targetVal) < 0.001 ? targetVal : blended;
                // Clean up keys that have fully returned to 0
                if (current[key] === 0 && (target[key] ?? 0) === 0) {
                  delete current[key];
                  continue;
                }
                coreModel.setParameterValueById(key, current[key]);
              }
            } catch {}

            // NOW do mesh deformation with our values applied
            origCoreUpdate();
          };

          debugLog("[Live2D] Per-frame patch applied (coreModel.update pre-deformation override)");
        } catch (err2) {
          console.warn("[Live2D] Could not patch per-frame update:", err2);
        }

        // Wait 2 frames for the watermark parameter to take effect before showing
        requestAnimationFrame(() => {
          requestAnimationFrame(() => {
            if (!destroyed) {
              setModelReady(true);
              onModelReadyRef.current?.();
              debugLog(`[Live2D] Model ready — revealing (total ${(performance.now() - loadStart).toFixed(0)}ms)`);

              // Delay expressions/accessories for 2s to let GPU settle
              modelStableTimer.current = setTimeout(() => {
                modelStableRef.current = true;
                debugLog("[Live2D] Model stable — expressions/accessories enabled");

                // Flush any queued emotion
                if (pendingEmotion.current && modelRef.current) {
                  const expr = pendingEmotion.current;
                  pendingEmotion.current = null;
                  try {
                    const mapped = EMOTION_MAP_STATIC[expr];
                    if (mapped) {
                      modelRef.current.expression(mapped);
                      debugLog(`[Live2D] Flushed queued expression: ${mapped}`);
                    }
                  } catch {}
                }

                // Flush any queued accessories
                if (pendingAccessories.current.length > 0 && modelRef.current) {
                  pendingAccessories.current.forEach(acc => {
                    try {
                      modelRef.current.expression(acc);
                      activeAccessoriesRef.current.add(acc);
                      debugLog(`[Live2D] Flushed queued accessory: ${acc}`);
                    } catch {}
                  });
                  pendingAccessories.current = [];
                }

                // Apply random initial hairstyle NOW — model is confirmed stable
                if (modelRef.current) {
                  const initialStyle = HAIRSTYLE_CYCLE[hairstyleIndexRef.current];
                  if (initialStyle) {
                    try {
                      modelRef.current.expression(initialStyle);
                      activeAccessoriesRef.current.add(initialStyle);
                    } catch (e) {
                      console.warn(`[Hair] Failed to apply initial: ${initialStyle}`, e);
                    }
                  }
                  debugLog(`[Hair] Initial style: default (cycle starts at 5min)`);

                  // Start 5-minute cycle timer
                  hairstyleCycleTimerRef.current = setInterval(() => {
                    hairstyleIndexRef.current = (hairstyleIndexRef.current + 1) % HAIRSTYLE_CYCLE.length;
                    const nextStyle = HAIRSTYLE_CYCLE[hairstyleIndexRef.current];
                    // Remove previous hair accessory
                    HAIR_ACCESSORIES.forEach(hair => activeAccessoriesRef.current.delete(hair));
                    if (nextStyle && modelRef.current) {
                      try {
                        modelRef.current.expression(nextStyle);
                        activeAccessoriesRef.current.add(nextStyle);
                      } catch (e) {
                        console.warn(`[Hair] Failed to apply: ${nextStyle}`, e);
                      }
                    }
                    debugLog(`[Hair] Cycled to: ${nextStyle ?? "default"} (index ${hairstyleIndexRef.current})`);
                  }, HAIRSTYLE_CYCLE_INTERVAL);
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
          const mobile = /iPhone|iPad|iPod|Android/i.test(navigator.userAgent);
          const sf = 0.9;
          const newBaseScale = Math.min(w / rawWidth, h / rawHeight) * sf;
          baseScaleRef.current = newBaseScale;
          baseYRef.current = h * (mobile ? 0.59 : 0.56);

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
      cleanupLive2D.current();
    };
  }, []);

  // Safety net: release GPU resources if the page is being unloaded (tab close,
  // hard navigation, etc.) — React's unmount may not fire in time on mobile Safari.
  useEffect(() => {
    const handleBeforeUnload = () => {
      cleanupLive2D.current();
    };
    window.addEventListener("beforeunload", handleBeforeUnload);
    return () => {
      window.removeEventListener("beforeunload", handleBeforeUnload);
    };
  }, []);

  // Lip sync via LipSyncEngine — smooth attack/release dynamics
  useEffect(() => {
    const model = modelRef.current;
    if (!model) return;

    // Helper: extract RMS amplitude from analyser (speech frequency bins only)
    function getAmplitude(): number {
      if (!analyserNode) return 0;
      const dataArray = new Uint8Array(analyserNode.frequencyBinCount);
      analyserNode.getByteFrequencyData(dataArray);

      // Use lower frequency bins (speech is mostly 85Hz–1kHz)
      // With fftSize=256 at 16kHz sample rate, each bin ≈ 62.5Hz
      // Bins 1-6 ≈ 62–375Hz (fundamental speech range)
      const speechBins = Math.min(40, dataArray.length);
      let sum = 0;
      for (let i = 1; i < speechBins; i++) {
        const normalized = dataArray[i] / 255;
        sum += normalized * normalized;
      }
      return Math.sqrt(sum / (speechBins - 1)); // RMS, 0.0–1.0
    }

    function animateMouth() {
      if (!modelRef.current) return;

      const now = performance.now();
      let smoothMouth: number;

      if (isSpeaking && analyserNode) {
        // Speaking — feed real amplitude through the engine
        const rawAmplitude = getAmplitude();
        smoothMouth = lipSyncEngine.current.update(rawAmplitude, now);
      } else {
        // Not speaking — feed zero so mouth closes via release curve (no snap)
        smoothMouth = lipSyncEngine.current.update(0, now);
      }

      try {
        const core = modelRef.current.internalModel?.coreModel;
        if (core) {
          core.setParameterValueById("ParamMouthOpenY", smoothMouth);
          core.setParameterValueById("ParamMouthForm", 0.15 + smoothMouth * 0.2);

          // Subtle head movement while speaking — nods with speech rhythm
          // ADDITIVE: read current value (from idle sway + emotion blend) and add lip-sync movement
          const speakNod = smoothMouth * 2; // 0 to 2 degrees based on mouth open
          const speakSway = Math.sin(Date.now() / 400) * smoothMouth * 1.5; // Gentle side-to-side
          const currentAngle8 = core.getParameterValueById?.("ParamAngle8") ?? 0;
          const currentAngle9 = core.getParameterValueById?.("ParamAngle9") ?? 0;
          core.setParameterValueById("ParamAngle8", currentAngle8 + speakNod);
          core.setParameterValueById("ParamAngle9", currentAngle9 + speakSway);
        }
      } catch {}

      // Keep running even when not speaking — release curve needs frames to close smoothly
      // Stop only when fully closed and not speaking
      if (!isSpeaking && smoothMouth === 0) {
        animFrameRef.current = 0;
        return;
      }

      animFrameRef.current = requestAnimationFrame(animateMouth);
    }

    // Start the animation loop
    animateMouth();

    return () => {
      if (animFrameRef.current) {
        cancelAnimationFrame(animFrameRef.current);
        animFrameRef.current = 0;
      }
    };
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
        debugLog("[Live2D] Expression cleared via manager");
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
      debugLog(`[Live2D] Queuing emotion — model not yet stable: ${emotion}`);
      pendingEmotion.current = emotion;
      return;
    }

    // Clear any pending reset
    if (expressionTimeoutRef.current) {
      clearTimeout(expressionTimeoutRef.current);
      expressionTimeoutRef.current = null;
    }

    // Track current emotion for speech-end logic
    currentEmotionRef.current = emotion;
    expressionWaitingForSpeechEnd.current = false;

    const expressionName = EMOTION_MAP[emotion];

    if (expressionName) {
      // Trigger the expression
      try {
        model.expression(expressionName);
        debugLog(`[Live2D] Expression: ${expressionName} (emotion: ${emotion})`);
      } catch (err) {
        console.warn(`[Live2D] Failed to set expression: ${expressionName}`, err);
      }

      // Set target params — the blend loop in coreModel.update will lerp to these smoothly
      const paramOverrides = EMOTION_PARAMS[emotion];
      if (paramOverrides) {
        targetEmotionParams.current = { ...paramOverrides };
        debugLog(`[Live2D] Emotion params targeted: ${Object.keys(paramOverrides).join(", ")}`);
      }

      // Speech-aware auto-reset: if speaking, defer reset until speech ends
      if (isSpeaking) {
        expressionWaitingForSpeechEnd.current = true;
        debugLog(`[Live2D] Expression held while speaking`);
      } else {
        // Not speaking — auto-reset after 4 seconds
        expressionTimeoutRef.current = setTimeout(() => {
          resetExpression(model);
          targetEmotionParams.current = {};
        }, 4000);
      }
    } else {
      // neutral/happy — clear any active expression
      resetExpression(model);
      // Apply happy params via blending if happy (subtle difference from neutral)
      if (emotion === "happy") {
        const paramOverrides = EMOTION_PARAMS.happy;
        if (paramOverrides) {
          targetEmotionParams.current = { ...paramOverrides };
        }
      } else {
        targetEmotionParams.current = {};
      }
    }
  }, [emotion, isSpeaking]);

  // Post-speech expression reset — when speech ends while an expression is held,
  // wait 2s then gracefully reset to neutral (allows expression to linger naturally)
  useEffect(() => {
    if (isSpeaking || !expressionWaitingForSpeechEnd.current) return;

    // Speech just ended and we were holding an expression — start 2s countdown
    expressionWaitingForSpeechEnd.current = false;
    const model = modelRef.current;
    if (!model) return;

    expressionTimeoutRef.current = setTimeout(() => {
      resetExpression(model);
      targetEmotionParams.current = {};
      debugLog("[Live2D] Post-speech expression reset (2s after speech ended)");
    }, 2000);

    return () => {
      if (expressionTimeoutRef.current) {
        clearTimeout(expressionTimeoutRef.current);
        expressionTimeoutRef.current = null;
      }
    };
  }, [isSpeaking]);

  // Watch for accessory changes — accessories persist (unlike emotions which flash)
  // Includes conflict resolution (e.g. headphones replaces earbuds) and 60s auto-removal
  useEffect(() => {
    const model = modelRef.current;
    if (!model) return;

    // Queue if model not yet stable
    if (!modelStableRef.current && accessories) {
      const newItems = accessories.filter(a => !activeAccessoriesRef.current.has(a));
      if (newItems.length > 0) {
        debugLog(`[Live2D] Queuing accessories — model not yet stable: ${newItems.join(", ")}`);
        pendingAccessories.current.push(...newItems);
      }
      return;
    }

    if (accessories) {
      const newSet = new Set(accessories);

      // Turn ON new accessories (with conflict resolution)
      Array.from(newSet).forEach(acc => {
        if (!activeAccessoriesRef.current.has(acc)) {
          // Remove conflicting accessories first
          const conflicts = ACCESSORY_CONFLICTS[acc];
          if (conflicts) {
            conflicts.forEach(conflicting => {
              if (activeAccessoriesRef.current.has(conflicting)) {
                try {
                  // Reset expression to clear it, then re-apply non-conflicting ones
                  activeAccessoriesRef.current.delete(conflicting);
                  debugLog(`[Live2D] Accessory conflict — removed ${conflicting} for ${acc}`);
                  // Clear its auto-remove timer
                  const timer = accessoryTimeoutRefs.current.get(conflicting);
                  if (timer) {
                    clearTimeout(timer);
                    accessoryTimeoutRefs.current.delete(conflicting);
                  }
                } catch {}
              }
            });
          }

          try {
            model.expression(acc);
            debugLog(`[Live2D] Accessory ON: ${acc}`);
          } catch (err) {
            console.warn(`[Live2D] Failed to apply accessory: ${acc}`, err);
          }

          // Auto-remove after per-accessory duration (default 60s)
          const durationSec = ACCESSORY_DURATIONS[acc] ?? 60;
          const timer = setTimeout(() => {
            activeAccessoriesRef.current.delete(acc);
            accessoryTimeoutRefs.current.delete(acc);
            debugLog(`[Live2D] Accessory auto-removed (${durationSec}s): ${acc}`);
          }, durationSec * 1000);
          accessoryTimeoutRefs.current.set(acc, timer);
        }
      });

      activeAccessoriesRef.current = newSet;
    }
  }, [accessories]);

  // Watch for action changes — actions are temporary (auto-clear after 10s)
  useEffect(() => {
    const model = modelRef.current;
    if (!model || !action) return;
    if (!modelStableRef.current) return;

    // Remove previous action's visual
    if (activeActionRef.current) {
      try {
        // Re-apply active accessories after clearing
        Array.from(activeAccessoriesRef.current).forEach(acc => {
          try { model.expression(acc); } catch {}
        });
      } catch {}
      activeActionRef.current = null;
    }

    // Clear pending timeout
    if (actionTimeoutRef.current) {
      clearTimeout(actionTimeoutRef.current);
    }

    // Apply new action
    try {
      model.expression(action);
      activeActionRef.current = action;
      debugLog(`[Live2D] Action ON: ${action}`);
    } catch (err) {
      console.warn(`[Live2D] Failed to apply action: ${action}`, err);
    }

    // Auto-remove after 10 seconds
    actionTimeoutRef.current = setTimeout(() => {
      try {
        // Re-apply accessories to clear the action expression
        Array.from(activeAccessoriesRef.current).forEach(acc => {
          try { model.expression(acc); } catch {}
        });
        activeActionRef.current = null;
        debugLog(`[Live2D] Action OFF: ${action}`);
      } catch {}
    }, 10000);

    return () => {
      if (actionTimeoutRef.current) clearTimeout(actionTimeoutRef.current);
    };
  }, [action]);

  // Clean up expression/action/accessory timeouts on unmount
  useEffect(() => {
    return () => {
      if (expressionTimeoutRef.current) {
        clearTimeout(expressionTimeoutRef.current);
      }
      if (actionTimeoutRef.current) {
        clearTimeout(actionTimeoutRef.current);
      }
      accessoryTimeoutRefs.current.forEach(timer => clearTimeout(timer));
      accessoryTimeoutRefs.current.clear();
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
    <div style={{ width: "100%", height: "100%", maxWidth: "600px", maxHeight: "90vh", margin: "0 auto", position: "relative", overflow: "hidden" }}>
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
