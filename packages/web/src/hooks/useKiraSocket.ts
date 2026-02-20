"use client";
import { useState, useEffect, useRef, useCallback } from "react";
import { useSceneDetection } from "./useSceneDetection";

// --- Persistent debug logger (survives page reloads via sessionStorage) ---
// Silent in production unless ?debug is in the URL
const isDebug = typeof window !== 'undefined' && (process.env.NODE_ENV !== 'production' || window.location.search.includes('debug'));
export function debugLog(...args: any[]) {
  if (!isDebug) return;
  const msg = `[${new Date().toISOString().slice(11, 23)}] ${args.map(a => typeof a === 'string' ? a : JSON.stringify(a)).join(' ')}`;
  console.log(...args);
  try {
    const logs = JSON.parse(sessionStorage.getItem('kira-debug') || '[]');
    logs.push(msg);
    if (logs.length > 200) logs.splice(0, logs.length - 200);
    sessionStorage.setItem('kira-debug', JSON.stringify(logs));
  } catch {}
}

// Define the states
type SocketState = "idle" | "connecting" | "connected" | "closing" | "closed";
export type KiraState = "listening" | "thinking" | "speaking";

// --- iOS / Safari AudioContext compatibility ---
// Older iOS Safari exposes webkitAudioContext instead of AudioContext.
const SafeAudioContext = (typeof window !== 'undefined'
  ? (window.AudioContext || (window as any).webkitAudioContext)
  : undefined) as typeof AudioContext | undefined;

// --- iOS audio session primer ---
// On iOS, when getUserMedia (mic) is active, the audio session defaults to "voice chat"
// which routes playback to the earpiece. Playing a silent <audio> element BEFORE starting
// the mic sets the session to "play and record" mode, routing output to the speaker.
const SILENT_WAV_DATA_URI = "data:audio/wav;base64,UklGRiQAAABXQVZFZm10IBAAAAABAAEARKwAAIhYAQACABAAZGF0YQAAAAA=";

async function primeIOSAudioSession(): Promise<void> {
  try {
    const silentAudio = new Audio(SILENT_WAV_DATA_URI);
    silentAudio.setAttribute("playsinline", "true");
    silentAudio.volume = 0.01; // Near-silent but non-zero to ensure audio session activates
    await silentAudio.play().catch(() => {});
    // Clean up after playback finishes
    silentAudio.onended = () => { silentAudio.remove(); };
    debugLog("[iOS] Audio session primed for speaker output");
  } catch {
    debugLog("[iOS] Audio session priming failed (non-fatal)");
  }
}

// ─── Window-level singleton — survives React remounts AND module re-evaluation ───
// Module-level vars can be re-created if Next.js re-evaluates the module during
// code splitting or dynamic imports. window is truly global and survives everything.
interface ConnectionStore {
  ws: WebSocket | null;
  socketState: SocketState;
  audioContext: AudioContext | null;
  playbackContext: AudioContext | null;
  audioStream: MediaStream | null;
  audioWorkletNode: AudioWorkletNode | null;
  audioSource: MediaStreamAudioSourceNode | null;
  playbackGain: GainNode | null;
  playbackAnalyser: AnalyserNode | null;
  isServerReady: boolean;
  conversationActive: boolean;
  reconnectAttempts: number;
}

function getConnectionStore(): ConnectionStore | null {
  if (typeof window === "undefined") return null;
  if (!(window as any).__kiraConnectionStore) {
    (window as any).__kiraConnectionStore = {
      ws: null,
      socketState: "idle",
      audioContext: null,
      playbackContext: null,
      audioStream: null,
      audioWorkletNode: null,
      audioSource: null,
      playbackGain: null,
      playbackAnalyser: null,
      isServerReady: false,
      conversationActive: false,
      reconnectAttempts: 0,
    } as ConnectionStore;
  }
  return (window as any).__kiraConnectionStore as ConnectionStore;
}

// Adaptive EOU: short utterances get snappy response, long utterances get patience for multi-part questions
const EOU_TIMEOUT_MIN = 500;   // 500ms silence for short utterances ("yes", "no", "hi")
const EOU_TIMEOUT_MAX = 1500;  // 1500ms silence for long multi-part questions
const LONG_UTTERANCE_FRAMES = 800; // ~2s of speech = "long utterance" (each frame ≈ 2.67ms at 48kHz)
const MIN_SPEECH_FRAMES_FOR_EOU = 200; // Must have ~200 speech frames (~1-2s real speech) to prevent noise-triggered EOUs
const VAD_STABILITY_FRAMES = 5; // Need 5 consecutive speech frames before considering "speaking"

// Hair accessories managed by cycle timer in Live2DAvatar — block from server-sent changes
const HAIR_ACCESSORIES = new Set(["clip_bangs", "low_twintails"]);

export const useKiraSocket = (getTokenFn: (() => Promise<string | null>) | null, guestId: string, voicePreference: string = "anime") => {
  // ─── Restore state from singleton if a live connection exists ───
  const [socketState, setSocketState] = useState<SocketState>(() => {
    // Use the stored socketState directly — it's authoritative
    if (getConnectionStore()!.socketState === "connected" || getConnectionStore()!.socketState === "connecting") {
      debugLog("[Hook] Restoring socketState →", getConnectionStore()!.socketState, "from singleton. ws:", !!getConnectionStore()!.ws);
      return getConnectionStore()!.socketState;
    }
    return "idle";
  });
  const [kiraState, setKiraState] = useState<KiraState>("listening");
  const kiraStateRef = useRef<KiraState>("listening"); // Ref to track state in callbacks

  // Log hook mount/unmount — DO NOT close WS on unmount (singleton survives remount)
  useEffect(() => {
    debugLog("[Hook] useKiraSocket MOUNTED. Singleton ws:", !!getConnectionStore()!.ws, 
      "readyState:", getConnectionStore()!.ws?.readyState,
      "socketState restored as:", getConnectionStore()!.ws?.readyState === WebSocket.OPEN ? "connected" : "idle");
    return () => {
      debugLog("[Hook] useKiraSocket UNMOUNTING — preserving singleton");
      // Sync current refs TO singleton only if they're alive.
      // NEVER overwrite singleton with null — that destroys the connection for the next mount.
      // The ONLY place that should null out singleton is disconnect() (explicit End Call).
      if (ws.current && ws.current.readyState === WebSocket.OPEN) {
        getConnectionStore()!.ws = ws.current;
        debugLog("[Hook] WebSocket preserved in singleton (readyState:", ws.current.readyState, ")");
      }
      if (audioContext.current) getConnectionStore()!.audioContext = audioContext.current;
      if (playbackContext.current) getConnectionStore()!.playbackContext = playbackContext.current;
      if (audioStream.current) getConnectionStore()!.audioStream = audioStream.current;
      if (audioWorkletNode.current) getConnectionStore()!.audioWorkletNode = audioWorkletNode.current;
      if (audioSource.current) getConnectionStore()!.audioSource = audioSource.current;
      if (playbackGain.current) getConnectionStore()!.playbackGain = playbackGain.current;
      if (playbackAnalyser.current) getConnectionStore()!.playbackAnalyser = playbackAnalyser.current;
      // Always sync these non-nullable flags
      getConnectionStore()!.isServerReady = isServerReady.current;
      getConnectionStore()!.conversationActive = conversationActive.current;
      getConnectionStore()!.reconnectAttempts = reconnectAttempts.current;
    };
  }, []);

  // ─── Handler refs: these always point to the latest closure ───
  // The actual WS handlers call through these refs, so remounts get fresh state setters.
  const onMessageRef = useRef<((event: MessageEvent) => void) | null>(null);
  const onCloseRef = useRef<((event: CloseEvent) => void) | null>(null);
  const onErrorRef = useRef<((event: Event) => void) | null>(null);

  // ─── Visual-ready gating: don't send start_stream until Live2D is loaded (or timeout) ───
  const visualReadyRef = useRef(false);
  const wsOpenRef = useRef(false); // true once ws.onopen fires

  // Sync ref with state
  useEffect(() => {
    kiraStateRef.current = kiraState;
  }, [kiraState]);

  const [micVolume, setMicVolume] = useState(0);
  const [transcript, setTranscript] = useState<{ role: "user" | "ai"; text: string } | null>(null);

  const [currentExpression, setCurrentExpression] = useState<string>("neutral");
  const [activeAccessories, setActiveAccessories] = useState<string[]>([]);
  const [currentAction, setCurrentAction] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [isAudioBlocked, setIsAudioBlocked] = useState(false);
  const [isMuted, setIsMuted] = useState(false);
  const [isScreenSharing, setIsScreenSharing] = useState(false);
  const [isCameraActive, setIsCameraActive] = useState(false);
  const [facingMode, setFacingMode] = useState<"environment" | "user">("environment");
  const [isPro, setIsPro] = useState(false);
  const isProRef = useRef(false); // Ref mirror of isPro for use in onclose callback
  const [remainingSeconds, setRemainingSeconds] = useState<number | null>(null);
  const [isAudioPlaying, setIsAudioPlaying] = useState(false);
  const audioPlayingTimeout = useRef<ReturnType<typeof setTimeout> | null>(null);

  // --- Visualizer: read AnalyserNode while audio is playing ---
  useEffect(() => {
    if (!isAudioPlaying) {
      setPlayerVolume(0);
      return;
    }

    let frame: number;
    const tick = () => {
      if (playbackAnalyser.current) {
        const data = new Uint8Array(playbackAnalyser.current.frequencyBinCount);
        playbackAnalyser.current.getByteFrequencyData(data);
        let sum = 0;
        for (let i = 0; i < data.length; i++) sum += data[i];
        const avg = sum / data.length / 255; // normalize 0-1
        setPlayerVolume(avg);
      }
      frame = requestAnimationFrame(tick);
    };
    tick();

    return () => cancelAnimationFrame(frame);
  }, [isAudioPlaying]);
  const ws = useRef<WebSocket | null>(getConnectionStore()!.ws);
  const isServerReady = useRef(getConnectionStore()!.isServerReady); // Gate for sending audio

  // --- Audio Pipeline Refs (restore from singleton if present) ---
  const audioContext = useRef<AudioContext | null>(getConnectionStore()!.audioContext);
  const audioWorkletNode = useRef<AudioWorkletNode | null>(getConnectionStore()!.audioWorkletNode);
  const audioSource = useRef<MediaStreamAudioSourceNode | null>(getConnectionStore()!.audioSource);
  const audioStream = useRef<MediaStream | null>(getConnectionStore()!.audioStream);

  // --- Screen Share Refs ---
  const screenStream = useRef<MediaStream | null>(null);
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const isScreenSharingRef = useRef(false); // Ref to track screen share state in callbacks

  // --- Camera Refs ---
  const cameraStreamRef = useRef<MediaStream | null>(null);
  const cameraVideoRef = useRef<HTMLVideoElement | null>(null);
  const cameraIntervalRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const isCameraActiveRef = useRef(false);

  // --- Scene Detection ---
  const lastSceneUpdateSent = useRef(0);
  const SCENE_UPDATE_COOLDOWN = 30000; // Don't send scene updates more than once per 30 seconds

  const handleSceneChange = useCallback((frames: string[]) => {
    const now = Date.now();
    if (
      now - lastSceneUpdateSent.current > SCENE_UPDATE_COOLDOWN &&
      ws.current?.readyState === WebSocket.OPEN &&
      isScreenSharingRef.current &&
      kiraStateRef.current === "listening"
    ) {
      lastSceneUpdateSent.current = now;
      ws.current.send(JSON.stringify({
        type: "scene_update",
        images: frames,
      }));
    }
  }, []);

  const sceneBuffer = useSceneDetection({
    videoRef,
    enabled: isScreenSharing,
    checkInterval: 2000,
    threshold: 15,
    onSceneChange: handleSceneChange,
  });
  const sceneBufferRef = useRef<string[]>([]);

  // Sync sceneBuffer to ref for access in callbacks
  useEffect(() => {
    sceneBufferRef.current = sceneBuffer;
  }, [sceneBuffer]);

  // --- Audio Playback Refs ---
  const audioQueue = useRef<ArrayBuffer[]>([]);
  const nextStartTime = useRef(0); // Track where the next chunk should start
  const isProcessingQueue = useRef(false); // Lock for the processing loop
  const scheduledSources = useRef<AudioBufferSourceNode[]>([]); // Track all scheduled sources
  const ttsChunksDone = useRef(true); // Whether server has finished sending audio for this turn

  const playbackContext = useRef<AudioContext | null>(getConnectionStore()!.playbackContext);
  const playbackSource = useRef<AudioBufferSourceNode | null>(null);
  const playbackGain = useRef<GainNode | null>(getConnectionStore()!.playbackGain);
  const playbackAnalyser = useRef<AnalyserNode | null>(getConnectionStore()!.playbackAnalyser);
  const playerVolumeFrame = useRef<number>(0);
  const [playerVolume, setPlayerVolume] = useState(0);

  // --- "Ramble Bot" EOU Timer ---
  const eouTimer = useRef<NodeJS.Timeout | null>(null);
  const maxUtteranceTimer = useRef<NodeJS.Timeout | null>(null);
  const speechFrameCount = useRef(0); // Track consecutive speech frames for VAD stability
  const totalSpeechFrames = useRef(0); // Total speech frames in current utterance (reset on EOU)
  const hasSpoken = useRef(false); // Whether user has spoken enough to trigger EOU

  // --- Latency Tracking ---
  const eouSentAt = useRef(0);
  const firstAudioLogged = useRef(false);

  // --- Vision: Snapshot Cooldown ---
  const lastSnapshotTime = useRef(0);
  const SNAPSHOT_COOLDOWN_MS = 5000; // One snapshot per 5 seconds max
  const periodicCaptureTimer = useRef<ReturnType<typeof setInterval> | null>(null);

  // --- WebSocket Auto-Reconnect ---
  const reconnectAttempts = useRef(getConnectionStore()!.reconnectAttempts);
  const MAX_RECONNECT_ATTEMPTS = 5;
  const conversationActive = useRef(getConnectionStore()!.conversationActive); // True once start_stream sent — prevents reconnect loops
  const isReconnecting = useRef(false);
  const reconnectTimer = useRef<NodeJS.Timeout | null>(null);
  const [connectionStatus, setConnectionStatus] = useState<"connected" | "reconnecting" | "disconnected">("connected");

  // --- Connection Health Check ---
  const lastServerMessage = useRef<number>(0); // Timestamp of last message from server

  /**
   * Calculates adaptive EOU timeout based on how long the user has been speaking.
   * Short utterances ("yes") → fast 500ms cutoff for snappy responses.
   * Long utterances (multi-part questions) → patient 1500ms to allow thinking pauses.
   */
  const getAdaptiveEOUTimeout = () => {
    const ratio = Math.min(totalSpeechFrames.current / LONG_UTTERANCE_FRAMES, 1.0);
    return Math.round(EOU_TIMEOUT_MIN + (EOU_TIMEOUT_MAX - EOU_TIMEOUT_MIN) * ratio);
  };

  /**
   * Stops current audio playback and clears the queue.
   */
  const stopAudioPlayback = useCallback(() => {
    // 1. Clear the queue so no new chunks are scheduled
    audioQueue.current = [];
    
    // 2. Stop ALL scheduled sources
    scheduledSources.current.forEach((source) => {
      try {
        source.stop();
      } catch (e) {
        // Ignore errors if already stopped
      }
    });
    scheduledSources.current = []; // Clear the list
    playbackSource.current = null;

    // 3. Reset scheduling time
    if (playbackContext.current) {
        nextStartTime.current = playbackContext.current.currentTime;
    } else {
        nextStartTime.current = 0;
    }

    // 4. Reset for next turn
    ttsChunksDone.current = true;

    // 5. Audio is no longer playing
    if (audioPlayingTimeout.current) {
      clearTimeout(audioPlayingTimeout.current);
      audioPlayingTimeout.current = null;
    }
    setIsAudioPlaying(false);
  }, []);

  /**
   * Processes the audio queue and schedules chunks to play back-to-back.
   * This eliminates gaps/pops caused by waiting for onended events.
   */
  const processAudioQueue = useCallback(async () => {
    if (isProcessingQueue.current) return;
    isProcessingQueue.current = true;

    // Resume contexts if suspended (mobile tab-switch, iOS auto-suspend)
    try {
      if (audioContext.current?.state === "suspended") await audioContext.current.resume();
      if (playbackContext.current?.state === "suspended") await playbackContext.current.resume();
    } catch (_) { /* best-effort */ }

    // Ensure the playback audio context is running (and is 16kHz for Azure's output)
    if (
      !playbackContext.current ||
      playbackContext.current.state === "closed"
    ) {
      playbackContext.current = new SafeAudioContext!({ sampleRate: 16000 });
      // Reset persistent audio chain when context is recreated
      playbackGain.current = null;
      playbackAnalyser.current = null;
    }
    if (playbackContext.current.state === "suspended") {
      await playbackContext.current.resume();
    }

    // Build persistent audio chain once: Source → GainNode → AnalyserNode → Destination
    if (!playbackGain.current) {
      playbackGain.current = playbackContext.current.createGain();
      playbackAnalyser.current = playbackContext.current.createAnalyser();
      playbackAnalyser.current.fftSize = 256;
      playbackAnalyser.current.smoothingTimeConstant = 0.3; // Moderate pre-smoothing — LipSyncEngine handles the rest
      playbackAnalyser.current.minDecibels = -90;
      playbackAnalyser.current.maxDecibels = -10;
      playbackGain.current.connect(playbackAnalyser.current);
      playbackAnalyser.current.connect(playbackContext.current.destination);
    }

    while (audioQueue.current.length > 0) {
      const buffer = audioQueue.current.shift();
      if (!buffer) continue;

      try {
        // 1. Decode the raw PCM buffer
        const wavBuffer = createWavHeader(buffer, 16000, 16);
        const audioBuffer = await playbackContext.current.decodeAudioData(
          wavBuffer
        );

        // 2. Create a source node and route through persistent gain
        const source = playbackContext.current.createBufferSource();
        source.buffer = audioBuffer;
        source.connect(playbackGain.current!);

        // 3. Schedule playback
        const currentTime = playbackContext.current.currentTime;
        // If nextStartTime is in the past (gap in stream), reset to now + small buffer
        if (nextStartTime.current < currentTime) {
          nextStartTime.current = currentTime + 0.02;
        }

        source.start(nextStartTime.current);
        nextStartTime.current += audioBuffer.duration;

        // Signal that audio is actively playing
        if (audioPlayingTimeout.current) {
          clearTimeout(audioPlayingTimeout.current);
          audioPlayingTimeout.current = null;
        }
        setIsAudioPlaying(true);

        // Keep track of the source so we can stop it later
        scheduledSources.current.push(source);
        source.onended = () => {
          // Remove from list when done to keep memory clean
          scheduledSources.current = scheduledSources.current.filter(s => s !== source);

          // When last source finishes and no more chunks coming, debounce isAudioPlaying off
          if (scheduledSources.current.length === 0 && audioQueue.current.length === 0) {
            audioPlayingTimeout.current = setTimeout(() => {
              // Double-check nothing new arrived in the gap
              if (scheduledSources.current.length === 0 && audioQueue.current.length === 0) {
                setIsAudioPlaying(false);
              }
            }, 300);
          }
        };

        // Keep track of the last source if we need to stop it manually later
        playbackSource.current = source;

      } catch (e) {
        console.error("[AudioPlayer] Error decoding or playing audio:", e);
      }
    }

    isProcessingQueue.current = false;
  }, []);

  const stopAudioPipeline = useCallback(() => {
    if (eouTimer.current) clearTimeout(eouTimer.current);

    audioWorkletNode.current?.port.close();
    audioSource.current?.disconnect();
    audioStream.current?.getTracks().forEach((track) => track.stop());
    screenStream.current?.getTracks().forEach((track) => track.stop()); // Stop screen share
    // Stop camera if active
    if (cameraStreamRef.current) {
      cameraStreamRef.current.getTracks().forEach(track => track.stop());
      cameraStreamRef.current = null;
    }
    if (cameraIntervalRef.current) {
      clearInterval(cameraIntervalRef.current);
      cameraIntervalRef.current = null;
    }
    if (cameraVideoRef.current) {
      cameraVideoRef.current.pause();
      cameraVideoRef.current.srcObject = null;
      cameraVideoRef.current = null;
    }
    setIsCameraActive(false);
    isCameraActiveRef.current = false;
    audioContext.current?.close().catch(console.error);
    playbackContext.current?.close().catch(console.error);

    audioWorkletNode.current = null;
    audioSource.current = null;
    audioStream.current = null;
    audioContext.current = null;
    playbackContext.current = null;
    playbackGain.current = null;

    // ─── Clear audio from singleton ───
    getConnectionStore()!.audioContext = null;
    getConnectionStore()!.playbackContext = null;
    getConnectionStore()!.audioStream = null;
    getConnectionStore()!.audioWorkletNode = null;
    getConnectionStore()!.audioSource = null;
    getConnectionStore()!.playbackGain = null;
    getConnectionStore()!.playbackAnalyser = null;

    debugLog("[Audio] 🛑 Audio pipeline stopped.");
  }, []);

  /**
   * Initializes audio contexts and requests mic permission.
   * Must be called from a user gesture.
   */
  const initializeAudio = useCallback(async () => {
    try {
      debugLog("[Audio] Initializing audio contexts...");

      // 1. Create/Resume AudioContext
      if (!audioContext.current || audioContext.current.state === "closed") {
        audioContext.current = new SafeAudioContext!();
        debugLog(`[Audio] Created capture AudioContext (sampleRate: ${audioContext.current.sampleRate})`);
      }
      if (audioContext.current.state === "suspended") {
        debugLog("[Audio] Capture AudioContext is suspended, resuming...");
        await audioContext.current.resume();
      }
      debugLog(`[Audio] Capture AudioContext state: ${audioContext.current.state}`);

      // 2. Create/Resume PlaybackContext
      if (!playbackContext.current || playbackContext.current.state === "closed") {
        playbackContext.current = new SafeAudioContext!({ sampleRate: 16000 });
        debugLog("[Audio] Created playback AudioContext (sampleRate: 16000)");
      }
      if (playbackContext.current.state === "suspended") {
        debugLog("[Audio] Playback AudioContext is suspended, resuming...");
        await playbackContext.current.resume();
      }
      debugLog(`[Audio] Playback AudioContext state: ${playbackContext.current.state}`);

      // 3. Request Mic Permission (if not already)
      if (!audioStream.current) {
        debugLog("[Audio] Requesting mic permission...");
        audioStream.current = await navigator.mediaDevices.getUserMedia({
          audio: {
            channelCount: 1,
            echoCancellation: true,
            autoGainControl: true,
            noiseSuppression: true,
          },
        });
        debugLog(`[Audio] Mic permission granted. Tracks: ${audioStream.current.getAudioTracks().length}, active: ${audioStream.current.active}`);
      } else {
        debugLog(`[Audio] Mic stream already exists. active: ${audioStream.current.active}`);
      }

      // iOS audio routing fix: prime audio session AFTER mic is acquired.
      // Must come after getUserMedia() so we don't consume the user gesture.
      // Plays a silent audio element to set iOS audio session to "play and record" mode,
      // routing TTS output to the speaker instead of the earpiece.
      primeIOSAudioSession();

      setIsAudioBlocked(false);
      return true;
    } catch (err) {
      debugLog("[Audio] ❌ Failed to initialize audio:", err);
      setIsAudioBlocked(true);
      return false;
    }
  }, []);

  /**
   * Toggles microphone mute state
   */
  const toggleMute = useCallback(() => {
    if (audioStream.current) {
      const audioTracks = audioStream.current.getAudioTracks();
      audioTracks.forEach(track => {
        track.enabled = !track.enabled;
      });
      setIsMuted(prev => !prev);
    }
  }, []);

  /**
   * Starts screen sharing
   */
  const startScreenShare = useCallback(async () => {
    try {
      const stream = await navigator.mediaDevices.getDisplayMedia({
        video: {
          width: { ideal: 1280 },
          height: { ideal: 720 },
          frameRate: { ideal: 10 } // Low framerate is fine for snapshots
        },
        audio: false
      });

      screenStream.current = stream;
      setIsScreenSharing(true);
      isScreenSharingRef.current = true;

      // Setup hidden video element for capturing frames
      if (!videoRef.current) {
        videoRef.current = document.createElement("video");
        videoRef.current.autoplay = true;
        videoRef.current.muted = true;
        videoRef.current.playsInline = true;
        // Ensure it's in the DOM so it processes frames
        videoRef.current.style.position = "absolute";
        videoRef.current.style.top = "-9999px";
        videoRef.current.style.left = "-9999px";
        videoRef.current.style.width = "1px";
        videoRef.current.style.height = "1px";
        videoRef.current.style.opacity = "0";
        videoRef.current.style.pointerEvents = "none";
        document.body.appendChild(videoRef.current);
      }
      videoRef.current.srcObject = stream;
      await videoRef.current.play();

      // Handle user stopping share via browser UI
      stream.getVideoTracks()[0].onended = () => {
        stopScreenShare();
      };

      debugLog("[Vision] Screen share started");
      
      // Send an initial snapshot immediately to establish context
      setTimeout(() => {
          const snapshot = captureScreenSnapshot();
          if (snapshot && ws.current?.readyState === WebSocket.OPEN) {
              debugLog("[Vision] Sending initial snapshot...");
              // Send buffer + current frame
              const payload = {
                  type: "image",
                  visionMode: "screen",
                  images: [...sceneBufferRef.current, snapshot]
              };
              ws.current.send(JSON.stringify(payload));
          } else {
              console.warn("[Vision] Failed to capture initial snapshot.");
          }
      }, 1000);

      // Start periodic captures every 15 seconds so the server always has fresh images
      if (periodicCaptureTimer.current) clearInterval(periodicCaptureTimer.current);
      periodicCaptureTimer.current = setInterval(() => {
        if (!isScreenSharingRef.current || !ws.current || ws.current.readyState !== WebSocket.OPEN) {
          if (periodicCaptureTimer.current) clearInterval(periodicCaptureTimer.current);
          periodicCaptureTimer.current = null;
          return;
        }
        const snapshot = captureScreenSnapshot();
        if (snapshot) {
          ws.current.send(JSON.stringify({
            type: "image",
            visionMode: "screen",
            images: [snapshot],
          }));
          debugLog("[Vision] Periodic snapshot sent.");
        }
      }, 15000);

    } catch (err) {
      console.error("[Vision] Failed to start screen share:", err);
      setIsScreenSharing(false);
    }
  }, []);

  /**
   * Stops screen sharing
   */
  const stopScreenShare = useCallback(() => {
    if (periodicCaptureTimer.current) {
      clearInterval(periodicCaptureTimer.current);
      periodicCaptureTimer.current = null;
    }
    if (screenStream.current) {
      screenStream.current.getTracks().forEach(track => track.stop());
      screenStream.current = null;
    }
    if (videoRef.current) {
      videoRef.current.srcObject = null;
      // Remove from DOM
      if (videoRef.current.parentNode) {
          videoRef.current.parentNode.removeChild(videoRef.current);
      }
      videoRef.current = null; // Reset ref
    }
    setIsScreenSharing(false);
    isScreenSharingRef.current = false;

    // Tell server to stop vision reactions
    if (ws.current && ws.current.readyState === WebSocket.OPEN) {
      ws.current.send(JSON.stringify({ type: "vision_stop" }));
    }

    debugLog("[Vision] Screen share stopped");
  }, []);

  /**
   * Captures a frame from the camera and sends it over WebSocket
   */
  const captureAndSendCameraFrame = useCallback(() => {
    const video = cameraVideoRef.current;
    if (!video || video.readyState < 2) return;

    const canvas = document.createElement("canvas");
    // Downscale to max 512px on longest side (same as screen share)
    const MAX_DIM = 512;
    const scale = Math.min(MAX_DIM / video.videoWidth, MAX_DIM / video.videoHeight, 1);
    canvas.width = Math.round(video.videoWidth * scale);
    canvas.height = Math.round(video.videoHeight * scale);

    const ctx = canvas.getContext("2d");
    if (!ctx) return;
    ctx.drawImage(video, 0, 0, canvas.width, canvas.height);

    const jpeg = canvas.toDataURL("image/jpeg", 0.5);
    const base64 = jpeg.split(",")[1];

    if (ws.current && ws.current.readyState === WebSocket.OPEN) {
      ws.current.send(JSON.stringify({
        type: "image",
        visionMode: "camera",
        images: [base64],
      }));
    }
  }, []);

  /**
   * Starts camera capture (mobile vision)
   */
  const startCamera = useCallback(async (mode?: "environment" | "user") => {
    const useFacing = mode || facingMode;
    debugLog("[Camera] startCamera called, facingMode:", useFacing);

    if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
      console.error("[Camera] getUserMedia not available — requires HTTPS");
      setError("Camera not available — HTTPS required");
      return;
    }

    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        video: {
          facingMode: useFacing,
          width: { ideal: 1280 },
          height: { ideal: 720 },
        },
        audio: false,
      });
      debugLog("[Camera] Got stream:", stream.getVideoTracks().length, "video tracks");

      cameraStreamRef.current = stream;

      const video = document.createElement("video");
      video.srcObject = stream;
      video.setAttribute("playsinline", "true");
      video.muted = true;
      await video.play();
      cameraVideoRef.current = video;

      setIsCameraActive(true);
      isCameraActiveRef.current = true;
      debugLog("[Camera] Camera started, facing:", useFacing);

      // Send initial snapshot
      setTimeout(() => {
        captureAndSendCameraFrame();
        debugLog("[Camera] Initial snapshot sent.");
      }, 500);

      // Start periodic captures — same 15s interval as screen share
      if (cameraIntervalRef.current) clearInterval(cameraIntervalRef.current);
      cameraIntervalRef.current = setInterval(() => {
        if (!isCameraActiveRef.current || !ws.current || ws.current.readyState !== WebSocket.OPEN) {
          if (cameraIntervalRef.current) clearInterval(cameraIntervalRef.current);
          cameraIntervalRef.current = null;
          return;
        }
        captureAndSendCameraFrame();
        debugLog("[Camera] Periodic snapshot sent.");
      }, 15000);

    } catch (err) {
      console.error("[Camera] Failed to start:", err);
      const msg = (err as Error).message || "Unknown camera error";
      if (msg.includes("NotAllowedError") || msg.includes("Permission")) {
        setError("Camera permission denied");
      } else {
        setError("Camera failed: " + msg);
      }
    }
  }, [facingMode, captureAndSendCameraFrame]);

  /**
   * Stops camera capture
   */
  const stopCamera = useCallback(() => {
    if (cameraIntervalRef.current) {
      clearInterval(cameraIntervalRef.current);
      cameraIntervalRef.current = null;
    }
    if (cameraStreamRef.current) {
      cameraStreamRef.current.getTracks().forEach(track => track.stop());
      cameraStreamRef.current = null;
    }
    if (cameraVideoRef.current) {
      cameraVideoRef.current.pause();
      cameraVideoRef.current.srcObject = null;
      cameraVideoRef.current = null;
    }
    setIsCameraActive(false);
    isCameraActiveRef.current = false;

    // Tell server to stop vision reactions
    if (ws.current && ws.current.readyState === WebSocket.OPEN) {
      ws.current.send(JSON.stringify({ type: "vision_stop" }));
    }

    debugLog("[Camera] Camera stopped.");
  }, []);

  /**
   * Flips from front to rear camera (or vice versa)
   */
  const flipCamera = useCallback(() => {
    const newMode = facingMode === "environment" ? "user" : "environment";
    setFacingMode(newMode);
    if (isCameraActiveRef.current) {
      stopCamera();
      setTimeout(() => startCamera(newMode), 300);
    }
  }, [facingMode, stopCamera, startCamera]);

  const captureScreenSnapshot = useCallback(() => {
    if (!videoRef.current || !screenStream.current) {
        console.warn("[Vision] Capture failed: No video or stream.");
        return null;
    }

    if (!canvasRef.current) {
      canvasRef.current = document.createElement("canvas");
    }

    const video = videoRef.current;
    const canvas = canvasRef.current;
    
    if (video.videoWidth === 0 || video.videoHeight === 0) {
        console.warn("[Vision] Capture failed: Video dimensions are 0.");
        return null;
    }

    // Downscale to max 512px on longest side (matches GPT-4o "low" detail)
    const MAX_DIM = 512;
    const scale = Math.min(MAX_DIM / video.videoWidth, MAX_DIM / video.videoHeight, 1);
    canvas.width = Math.round(video.videoWidth * scale);
    canvas.height = Math.round(video.videoHeight * scale);

    const ctx = canvas.getContext("2d");
    if (!ctx) return null;

    ctx.drawImage(video, 0, 0, canvas.width, canvas.height);
    
    // Lower quality since images are already small
    return canvas.toDataURL("image/jpeg", 0.5);
  }, []);

  /**
   * Initializes and starts the audio capture pipeline (Mic -> Worklet -> WebSocket)
   */
  const startAudioPipeline = useCallback(async () => {
    if (!ws.current || ws.current.readyState !== WebSocket.OPEN) {
      debugLog("[Audio] ❌ WebSocket not open, cannot start pipeline.");
      return;
    }

    try {
      // Ensure audio is initialized (should be done by connect/initializeAudio already)
      if (!audioStream.current) {
         const success = await initializeAudio();
         if (!success) throw new Error("Audio initialization failed");
      }

      // 2. Load AudioWorklet module
      if (!audioContext.current) throw new Error("AudioContext is null");
      
      debugLog("[Audio] Loading AudioWorklet module...");
      try {
        // Use a robust path for the worklet
        const workletUrl = "/worklets/AudioWorkletProcessor.js";
        // Check if module is already added (not directly possible, but addModule is idempotent-ish or throws)
        // We'll just try adding it.
        await audioContext.current.audioWorklet.addModule(workletUrl);
        debugLog("[Audio] AudioWorklet module loaded.");
      } catch (e) {
        // Ignore error if module already added (DOMException)
        debugLog("[Audio] Worklet might already be loaded:", e);
      }

      // 3. Create the Worklet Node
      if (!audioWorkletNode.current) {
          audioWorkletNode.current = new AudioWorkletNode(
            audioContext.current,
            "audio-worklet-processor",
            {
              processorOptions: {
                targetSampleRate: 16000,
              },
            }
          );
          
          audioWorkletNode.current.onprocessorerror = (err) => {
            console.error("[Audio] Worklet processor error:", err);
          };

          // 5. Connect the Worklet to the main app (this hook)
          audioWorkletNode.current.port.onmessage = (event) => {
            // ... (Existing message handler logic) ...
            // Handle Debug Messages from Worklet
            if (event.data && event.data.type === "debug") {
               debugLog("[AudioWorklet]", event.data.message);
               return;
            }
    
            // We received a 16-bit PCM buffer from the worklet
            const pcmBuffer = event.data as ArrayBuffer;
    
            // Safety: skip empty/detached buffers
            if (!pcmBuffer || pcmBuffer.byteLength === 0) return;

            // Calculate Mic Volume (RMS)
            const pcmData = new Int16Array(pcmBuffer);
            if (pcmData.length === 0) return;

            let sum = 0;
            for (let i = 0; i < pcmData.length; i++) {
              sum += pcmData[i] * pcmData[i];
            }
            const rms = Math.sqrt(sum / pcmData.length);
            // Normalize (16-bit max is 32768)
            // Multiply by a factor to make it more sensitive visually
            const rawVolume = Math.min(1, (rms / 32768) * 5);
            
            setMicVolume((prev) => {
                const smoothingFactor = 0.3; 
                return prev * (1 - smoothingFactor) + rawVolume * smoothingFactor;
            });
    
            if (
              ws.current?.readyState === WebSocket.OPEN &&
              isServerReady.current
            ) {
              // Only send audio when listening — no interrupt feature
              if (kiraStateRef.current === "listening") {
                ws.current.send(pcmBuffer);
              }
    
              // VAD & EOU Logic — only runs in listening state
              // (no interrupt feature; Kira finishes her response before we process speech)
              if (kiraStateRef.current === "listening") {
              const VAD_THRESHOLD = 300; 
              const isSpeakingFrame = rms > VAD_THRESHOLD;
    
              if (isSpeakingFrame) {
                speechFrameCount.current++;
                totalSpeechFrames.current++;
              } else {
                speechFrameCount.current = 0;
              }
    
              const isSpeaking = speechFrameCount.current > VAD_STABILITY_FRAMES;

              // Mark that the user has spoken enough to warrant an EOU
              if (totalSpeechFrames.current >= MIN_SPEECH_FRAMES_FOR_EOU) {
                hasSpoken.current = true;
              }
    
              if (isSpeaking) {
                // --- VISION: Snapshot-on-Speech ---
                // If this is the START of speech (transition from silence), capture a frame
                // Cooldown prevents re-triggering from micro-dips in natural speech
                if (speechFrameCount.current === (VAD_STABILITY_FRAMES + 1) && totalSpeechFrames.current >= 100) {
                    const now = Date.now();
                    if (now - lastSnapshotTime.current > SNAPSHOT_COOLDOWN_MS) {
                        // Screen share path
                        if (isScreenSharingRef.current) {
                            lastSnapshotTime.current = now;
                            debugLog("[Vision] Speech start detected while screen sharing. Attempting capture...");
                            const snapshot = captureScreenSnapshot();
                            if (snapshot) {
                                debugLog("[Vision] Sending snapshot on speech start...");
                                const payload = {
                                    type: "image",
                                    images: [...sceneBufferRef.current, snapshot]
                                };
                                ws.current.send(JSON.stringify(payload));
                            } else {
                                console.warn("[Vision] Snapshot capture returned null.");
                            }
                        }
                        // Camera path (mobile)
                        if (isCameraActiveRef.current) {
                            lastSnapshotTime.current = now;
                            debugLog("[Camera] Sending snapshot on speech start...");
                            captureAndSendCameraFrame();
                        }
                    }
                }

                // User is speaking — cancel any pending EOU timer
                if (eouTimer.current) {
                  clearTimeout(eouTimer.current);
                  eouTimer.current = null;
                }
    
                if (!maxUtteranceTimer.current) {
                  maxUtteranceTimer.current = setTimeout(() => {
                    debugLog("[EOU] Max utterance length reached. Forcing EOU.");
                    if (ws.current?.readyState === WebSocket.OPEN) {
                      eouSentAt.current = Date.now();
                      firstAudioLogged.current = false;
                      debugLog(`[Latency] EOU sent at ${eouSentAt.current}`);
                      ws.current.send(JSON.stringify({ type: "eou", forced: true }));
                    }
                    if (eouTimer.current) clearTimeout(eouTimer.current);
                    eouTimer.current = null;
                    maxUtteranceTimer.current = null;
                    // Reset speech tracking for next utterance
                    totalSpeechFrames.current = 0;
                    hasSpoken.current = false;
                  }, 60000); 
                }
              } else {
                // Silence detected — start EOU timer if user has spoken enough
                if (!eouTimer.current && hasSpoken.current) {
                  const adaptiveTimeout = getAdaptiveEOUTimeout();
                  eouTimer.current = setTimeout(() => {
                    debugLog(`[EOU] Silence detected after speech (${totalSpeechFrames.current} speech frames, timeout: ${adaptiveTimeout}ms), sending End of Utterance.`);
                    if (ws.current?.readyState === WebSocket.OPEN) {
                      eouSentAt.current = Date.now();
                      firstAudioLogged.current = false;
                      debugLog(`[Latency] EOU sent at ${eouSentAt.current}`);
                      ws.current.send(JSON.stringify({ type: "eou" }));
                    }
                    eouTimer.current = null;
                    if (maxUtteranceTimer.current) {
                      clearTimeout(maxUtteranceTimer.current);
                      maxUtteranceTimer.current = null;
                    }
                    // Reset speech tracking for next utterance
                    totalSpeechFrames.current = 0;
                    hasSpoken.current = false;
                  }, adaptiveTimeout);
                }
              }
              } // end if (kiraStateRef.current === "listening")
            }
          };
      }

      // 4. Connect the Mic to the Worklet (if not already)
      if (audioSource.current) audioSource.current.disconnect();
      
      debugLog("[Audio] Connecting mic to worklet...");
      if (audioStream.current) {
        audioSource.current = audioContext.current.createMediaStreamSource(
          audioStream.current
        );
        audioSource.current.connect(audioWorkletNode.current);
      } else {
        console.error("[Audio] No audio stream available to connect.");
      }

      // WORKAROUND: Connect worklet to a silent destination
      const silentGain = audioContext.current.createGain();
      silentGain.gain.value = 0;
      audioWorkletNode.current.connect(silentGain);
      silentGain.connect(audioContext.current.destination);

      debugLog("[Audio] ✅ Audio pipeline started.");
    } catch (err) {
      console.error("[Audio] ❌ Failed to start audio pipeline:", err);
      setError("Microphone access denied or failed. Please check permissions.");
    }
  }, [stopAudioPlayback, initializeAudio, captureScreenSnapshot]);

  /**
   * Explicitly start the conversation: send start_stream and start mic pipeline.
   * Adds detailed logs to trace user action and pipeline startup.
   */
  const startConversation = useCallback(() => {
    debugLog("[StartConvo] startConversation called. ws exists:", !!ws.current, "readyState:", ws.current?.readyState, "conversationActive:", conversationActive.current);
    
    // Idempotent — if conversation is already active (e.g. restored from singleton after remount), skip
    if (conversationActive.current) {
      debugLog("[StartConvo] Already active — skipping duplicate start_stream");
      return;
    }
    
    if (ws.current && ws.current.readyState === WebSocket.OPEN) {
      debugLog("[StartConvo] Sending 'start_stream' message...");
      try {
        ws.current.send(JSON.stringify({ type: "start_stream" }));
        conversationActive.current = true; // Mark session as live — no more auto-reconnect
        getConnectionStore()!.conversationActive = true;
        debugLog("[StartConvo] start_stream sent, conversationActive=true");
      } catch (err) {
        debugLog("[StartConvo] ❌ Failed to send start_stream:", err);
      }
      
      // Start mic immediately to satisfy browser user-gesture requirements
      debugLog("[StartConvo] Starting local audio pipeline...");
      startAudioPipeline();
    } else {
      debugLog(
        "[StartConvo] ❌ Cannot start: WebSocket not open. ws:", !!ws.current, "readyState:", ws.current?.readyState
      );
    }
  }, [startAudioPipeline]);

  /**
   * Signal that the visual layer (Live2D avatar or orb) is ready.
   * If the WebSocket is already open but waiting, this triggers start_stream + mic pipeline.
   */
  const signalVisualReady = useCallback(() => {
    if (visualReadyRef.current) return; // Already signaled
    visualReadyRef.current = true;
    debugLog("[VisualReady] Visual layer ready. wsOpen:", wsOpenRef.current, "conversationActive:", conversationActive.current);

    if (wsOpenRef.current && !conversationActive.current) {
      debugLog("[VisualReady] WS already open — sending start_stream now");
      startConversation();
    }
  }, [startConversation]);

  /**
   * Explicitly resume audio contexts.
   * Call this from a user gesture (click/tap) if audio is blocked.
   */
  const resumeAudio = useCallback(async () => {
    await initializeAudio();
  }, [initializeAudio]);

  /**
   * Resume both AudioContexts if they were suspended (e.g. mobile tab-switch, iOS auto-suspend).
   * Lightweight — safe to call frequently from processAudioQueue and visibility handlers.
   */
  const resumeAudioContext = useCallback(async () => {
    try {
      if (audioContext.current?.state === "suspended") {
        debugLog("[Audio] Resuming suspended capture AudioContext");
        await audioContext.current.resume();
      }
      if (playbackContext.current?.state === "suspended") {
        debugLog("[Audio] Resuming suspended playback AudioContext");
        await playbackContext.current.resume();
      }
    } catch (err) {
      debugLog("[Audio] ⚠️ Failed to resume AudioContext:", err);
    }
  }, []);

  // ─── Mobile tab-switch recovery: resume AudioContexts when page becomes visible again ───
  // iOS suspends AudioContext when the app goes to background or during audio route changes.
  // Re-priming the audio session ensures speaker routing is maintained after interruptions.
  useEffect(() => {
    const handleVisibilityChange = () => {
      if (document.visibilityState === "visible" && conversationActive.current) {
        debugLog("[Visibility] Page became visible — resuming AudioContexts + re-priming iOS audio session");
        primeIOSAudioSession(); // Re-prime speaker routing after iOS audio session interruption
        resumeAudioContext();
      }
    };
    document.addEventListener("visibilitychange", handleVisibilityChange);
    return () => document.removeEventListener("visibilitychange", handleVisibilityChange);
  }, [resumeAudioContext]);

  // ─── Connection health check: detect silently dead WebSocket connections ───
  // Server sends heartbeat pings every 25s. If we haven't received ANY message in 45s,
  // the connection is likely dead (network change, server crash, etc.). Close and show error.
  useEffect(() => {
    const HEALTH_CHECK_INTERVAL = 15_000; // Check every 15s
    const HEALTH_CHECK_TIMEOUT = 45_000;  // Dead if no message in 45s

    const timer = setInterval(() => {
      if (
        conversationActive.current &&
        lastServerMessage.current > 0 &&
        ws.current?.readyState === WebSocket.OPEN &&
        Date.now() - lastServerMessage.current > HEALTH_CHECK_TIMEOUT
      ) {
        debugLog(`[HealthCheck] No server message in ${Math.round((Date.now() - lastServerMessage.current) / 1000)}s — closing connection`);
        ws.current.close(4001, "Client health check timeout");
      }
    }, HEALTH_CHECK_INTERVAL);

    return () => clearInterval(timer);
  }, []);

  // --- Network change detection: proactively reconnect on WiFi→cellular etc. ---
  useEffect(() => {
    const handleOnline = () => {
      debugLog("[Network] Back online — checking connection");
      if (ws.current?.readyState !== WebSocket.OPEN) {
        attemptReconnect();
      }
    };

    const handleOffline = () => {
      debugLog("[Network] Went offline");
      setConnectionStatus("reconnecting");
    };

    window.addEventListener("online", handleOnline);
    window.addEventListener("offline", handleOffline);

    return () => {
      window.removeEventListener("online", handleOnline);
      window.removeEventListener("offline", handleOffline);
    };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  /**
   * Attempt to silently reconnect after a network drop or abnormal closure.
   * Uses exponential backoff with jitter (1s, 2s, 4s, 8s, 8s).
   * Shows a subtle "reconnecting" indicator instead of the full disconnect banner.
   */
  const attemptReconnect = useCallback(() => {
    if (isReconnecting.current) return;
    if (reconnectAttempts.current >= MAX_RECONNECT_ATTEMPTS) {
      // Give up after 5 attempts — show disconnect message with retry option
      debugLog("[Reconnect] All attempts exhausted — showing disconnect message");
      setError("connection_lost");
      setConnectionStatus("disconnected");
      reconnectAttempts.current = 0;
      getConnectionStore()!.reconnectAttempts = 0;
      return;
    }

    isReconnecting.current = true;
    reconnectAttempts.current++;
    getConnectionStore()!.reconnectAttempts = reconnectAttempts.current;

    const delay = Math.min(1000 * Math.pow(2, reconnectAttempts.current - 1), 8000);
    const jitter = Math.random() * 500;

    debugLog(`[Reconnect] Attempt ${reconnectAttempts.current}/${MAX_RECONNECT_ATTEMPTS} in ${Math.round(delay + jitter)}ms`);

    // Show subtle reconnecting indicator (NOT the full disconnect message)
    setConnectionStatus("reconnecting");

    reconnectTimer.current = setTimeout(async () => {
      try {
        await connect({ isReconnect: true });
        reconnectAttempts.current = 0;
        getConnectionStore()!.reconnectAttempts = 0;
        isReconnecting.current = false;
        setConnectionStatus("connected");
        setError(null);
        debugLog("[Reconnect] ✅ Reconnected successfully");
      } catch (err) {
        debugLog("[Reconnect] Failed:", err);
        isReconnecting.current = false;
        attemptReconnect(); // Try again
      }
    }, delay + jitter);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  /**
   * Main connection logic
   */
  const connect = useCallback(async (options?: { isReconnect?: boolean }) => {
    const isReconnectAttempt = options?.isReconnect ?? false;
    if (ws.current) {
      debugLog("[Connect] Aborted — WebSocket already exists");
      return;
    }

    debugLog(`[Connect] Starting connection attempt... (isReconnect: ${isReconnectAttempt})`);

    // Initialize Audio IMMEDIATELY (Synchronously inside gesture if possible)
    const audioOk = await initializeAudio();
    debugLog(`[Connect] Audio initialized: ${audioOk}`);
    if (!audioOk) {
      debugLog("[Connect] ❌ Failed: audio initialization returned false (mic denied or AudioContext failed)");
      return;
    }

    // Fetch a FRESH auth token right before connecting — prevents stale JWT race conditions
    // (token fetched at mount time can expire before the user clicks "start")
    let freshToken: string | null = null;
    if (getTokenFn) {
      try {
        freshToken = await getTokenFn();
        debugLog("[Connect] Auth token fetched successfully");
      } catch (err) {
        debugLog("[Connect] ❌ Failed to get fresh token:", err);
      }
    }

    const wsUrl = process.env.NEXT_PUBLIC_WEBSOCKET_URL!;
    const authParam = freshToken ? `token=${freshToken}` : `guestId=${guestId}`;
    const voiceParam = `&voice=${voicePreference}`;
    const tzParam = `&tz=${new Date().getTimezoneOffset()}`;
    const reconnectParam = isReconnectAttempt ? "&reconnect=true" : "";
    debugLog(`[Connect] Opening WS: ${wsUrl}?${authParam}${voiceParam}${tzParam}${reconnectParam}`);

    debugLog("[State] socketState → connecting");
    setSocketState("connecting");
    getConnectionStore()!.socketState = "connecting";
    isServerReady.current = false;
    ws.current = new WebSocket(`${wsUrl}?${authParam}${voiceParam}${tzParam}${reconnectParam}`);
    ws.current.binaryType = "arraybuffer"; // We are sending and receiving binary

    // ─── Store to singleton immediately so remounts can find it ───
    debugLog("[Singleton] getConnectionStore()!.ws → WebSocket (from connect, pre-open)");
    getConnectionStore()!.ws = ws.current;

    ws.current.onopen = () => {
      debugLog("[State] socketState → connected");
      setSocketState("connected");
      getConnectionStore()!.socketState = "connected";
      reconnectAttempts.current = 0; // Reset on successful connection
      getConnectionStore()!.reconnectAttempts = 0;
      isReconnecting.current = false;
      setConnectionStatus("connected");
      setError(null); // Clear any error banner from a previous disconnect
      debugLog("[Connect] ✅ WebSocket connected. Singleton stored immediately.");
      // Store audio refs to singleton now that connection is live
      getConnectionStore()!.audioContext = audioContext.current;
      getConnectionStore()!.playbackContext = playbackContext.current;
      getConnectionStore()!.audioStream = audioStream.current;
      
      // ─── Visual-ready gating ───
      // Don't send start_stream until the visual layer (Live2D / orb) signals ready.
      // This prevents the server from sending audio before the user sees anything.
      // Fallback: 15s timeout so we never hang forever if Live2D fails silently.
      wsOpenRef.current = true;

      // On reconnect, visual is already loaded — reset conversationActive so startConversation works
      if (isReconnectAttempt) {
        conversationActive.current = false;
        getConnectionStore()!.conversationActive = false;
      }

      if (visualReadyRef.current) {
        // Visual is already loaded (orb mode, or Live2D preloaded fast) — start immediately
        debugLog("[Connect] Visual already ready — sending start_stream now");
        if (!conversationActive.current) {
          startConversation();
        }
      } else {
        // Visual not ready yet — wait for signalVisualReady() or 15s timeout
        debugLog("[Connect] Waiting for visual ready signal (15s timeout)...");
        setTimeout(() => {
          if (!conversationActive.current && wsOpenRef.current) {
            debugLog("[Connect] ⏱ Visual-ready timeout (15s) — sending start_stream anyway");
            startConversation();
          }
        }, 15000);
      }
    };

    // ─── Wire handlers through refs so remounts get fresh closures ───
    onMessageRef.current = (event: MessageEvent) => {
      lastServerMessage.current = Date.now(); // Track for health check
      if (typeof event.data === "string") {
        // This is a JSON control message
        const msg = JSON.parse(event.data);
        debugLog("[WS] ← message:", msg.type, msg.type === "session_config" ? JSON.stringify(msg).slice(0, 200) : "");

        switch (msg.type) {
          case "session_config":
            debugLog("[WS] Received session_config:", JSON.stringify(msg));
            setIsPro(msg.isPro);
            isProRef.current = msg.isPro;
            if (msg.remainingSeconds !== undefined) {
              setRemainingSeconds(msg.remainingSeconds);
            }
            break;
          case "stream_ready":
            debugLog("[WS] Received stream_ready — setting kiraState to listening");
            setKiraState("listening");
            isServerReady.current = true;
            getConnectionStore()!.isServerReady = true;
            break;
          case "ping":
            // Respond to server heartbeat to keep connection alive
            if (ws.current?.readyState === WebSocket.OPEN) {
                ws.current.send(JSON.stringify({ type: "pong" }));
            }
            break;
          case "state_thinking":
            kiraStateRef.current = "thinking";
            if (eouTimer.current) clearTimeout(eouTimer.current); // Stop EOU timer
            setKiraState("thinking");
            break;
          case "state_speaking":
            kiraStateRef.current = "speaking";
            setKiraState("speaking");
            // CRITICAL: Stop any audio still playing from a previous turn
            // This prevents double-speak when a proactive comment overlaps with a user response
            scheduledSources.current.forEach((source) => {
              try { source.stop(); } catch (e) { /* already stopped */ }
            });
            scheduledSources.current = [];
            playbackSource.current = null;
            audioQueue.current = [];
            if (playbackContext.current) {
              nextStartTime.current = playbackContext.current.currentTime;
            } else {
              nextStartTime.current = 0;
            }
            if (audioPlayingTimeout.current) {
              clearTimeout(audioPlayingTimeout.current);
              audioPlayingTimeout.current = null;
            }
            ttsChunksDone.current = false;
            break;
          case "state_listening":
            kiraStateRef.current = "listening";
            setKiraState("listening");
            break;
          case "transcript":
            setTranscript({ role: msg.role, text: msg.text });
            break;
          case "expression":
            setCurrentExpression(msg.expression || "neutral");
            // Handle action/accessory fields from context detection
            if (msg.action) setCurrentAction(msg.action);
            if (msg.accessory && !HAIR_ACCESSORIES.has(msg.accessory)) {
              setActiveAccessories(prev =>
                prev.includes(msg.accessory) ? prev : [...prev, msg.accessory]
              );
            }
            if (msg.removeAccessory && !HAIR_ACCESSORIES.has(msg.removeAccessory)) {
              setActiveAccessories(prev =>
                prev.filter((a: string) => a !== msg.removeAccessory)
              );
            }
            break;
          case "accessory": {
            const { accessory, action } = msg;
            // Hair accessories are managed by the cycle timer — ignore server commands
            if (HAIR_ACCESSORIES.has(accessory)) break;
            setActiveAccessories(prev => {
              if (action === "on") {
                return prev.includes(accessory) ? prev : [...prev, accessory];
              } else {
                return prev.filter(a => a !== accessory);
              }
            });
            break;
          }
          case "tts_chunk_starts":
            ttsChunksDone.current = false; // More audio chunks incoming
            break;
          case "tts_chunk_ends":
            // The server is done sending audio for this turn
            ttsChunksDone.current = true; // Visualizer can now self-terminate when queue drains
            break;
          case "interrupt":
            // Server detected barge-in — immediately stop all audio playback
            scheduledSources.current.forEach((source) => {
              try { source.stop(); } catch (e) { /* already stopped */ }
            });
            scheduledSources.current = [];
            playbackSource.current = null;
            audioQueue.current = [];
            if (playbackContext.current) {
              nextStartTime.current = playbackContext.current.currentTime;
            }
            if (audioPlayingTimeout.current) {
              clearTimeout(audioPlayingTimeout.current);
              audioPlayingTimeout.current = null;
            }
            ttsChunksDone.current = true;
            console.log("[WS] Interrupt received — audio stopped");
            break;
          case "text_response":
            setTranscript({ role: "ai", text: msg.text });
            // Orb goes to "speaking" briefly to visually acknowledge
            kiraStateRef.current = "speaking";
            setKiraState("speaking");
            setTimeout(() => {
              kiraStateRef.current = "listening";
              setKiraState("listening");
            }, 1500);
            break;
          case "error":
            if (msg.code === "limit_reached") {
              if (msg.tier === "pro") {
                debugLog("[WS] ⚠️ Pro monthly limit reached.");
                setError("limit_reached_pro");
              } else {
                debugLog("[WS] ⚠️ Daily limit reached.");
                setError("limit_reached");
              }
            } else {
              debugLog("[WS] ❌ Server error:", msg.message);
              setError(msg.message);
            }
            break;
        }
      } else if (event.data instanceof ArrayBuffer) {
        // This is a raw PCM audio chunk from Azure
        // Only process audio if we are in 'speaking' state.
        // If we are 'listening' (e.g. due to interruption), we drop these packets.
        if (kiraStateRef.current === "speaking") {
            if (!firstAudioLogged.current && eouSentAt.current > 0) {
              firstAudioLogged.current = true;
              debugLog(`[Latency] Client: EOU → first audio: ${Date.now() - eouSentAt.current}ms`);
            }
            audioQueue.current.push(event.data);
            processAudioQueue();
        }
      }
    };

    onCloseRef.current = (event: CloseEvent) => {
      debugLog("[WS] 🔌 Connection closed. Code:", event.code, "Reason:", event.reason, "Clean:", event.wasClean);
      debugLog("[Singleton] getConnectionStore()!.ws → null (from onclose). Caller:", new Error().stack?.split('\n')[1]?.trim());
      debugLog("[State] socketState → closed (from onclose)");
      setSocketState("closed");
      getConnectionStore()!.socketState = "closed";
      wsOpenRef.current = false; // WS is no longer open
      
      // ─── Clear singleton ───
      getConnectionStore()!.ws = null;
      getConnectionStore()!.isServerReady = false;

      // --- Intentional server kicks — no reconnect ---
      if (event.code === 1008) {
        // Don't overwrite a more specific error (e.g. "limit_reached_pro")
        // If user is Pro, always use "limit_reached_pro" — never show the free-tier paywall
        setError((prev) => {
          if (prev?.startsWith("limit_reached")) return prev;
          return isProRef.current ? "limit_reached_pro" : "limit_reached";
        });
        getConnectionStore()!.conversationActive = false;
        stopAudioPipeline();
        ws.current = null;
        isServerReady.current = false;
        return;
      }

      // --- User-initiated disconnect (code 1000 from disconnect()) ---
      if (event.code === 1000) {
        getConnectionStore()!.conversationActive = false;
        stopAudioPipeline();
        ws.current = null;
        isServerReady.current = false;
        return;
      }

      // --- Everything else: network drops, heartbeat timeout, abnormal closure ---
      // Attempt auto-reconnect silently
      stopAudioPipeline();
      ws.current = null;
      isServerReady.current = false;

      attemptReconnect();
    };

    onErrorRef.current = (err: Event) => {
      debugLog("[WS] ❌ WebSocket error event fired:", err);
      // Don't null getConnectionStore()!.ws here — onclose ALWAYS fires after onerror
      // and handles singleton cleanup + reconnect logic. Nulling here would race.
      // Don't set socketState or call stopAudioPipeline — let onclose handle it all.
    };

    // ─── Wire WS events through refs (so remounts refresh closures) ───
    ws.current.onmessage = (e) => onMessageRef.current?.(e);
    ws.current.onclose = (e) => onCloseRef.current?.(e);
    ws.current.onerror = (e) => onErrorRef.current?.(e);

  }, [getTokenFn, guestId, startConversation, startAudioPipeline, processAudioQueue, stopAudioPipeline, initializeAudio]);

  const disconnect = useCallback(() => {
    debugLog("[WS] disconnect() called. ws.current exists:", !!ws.current);
    if (eouTimer.current) clearTimeout(eouTimer.current);
    if (reconnectTimer.current) clearTimeout(reconnectTimer.current);
    reconnectAttempts.current = MAX_RECONNECT_ATTEMPTS; // Prevent any reconnection
    isReconnecting.current = false;
    conversationActive.current = false; // Clean shutdown — not a crash
    visualReadyRef.current = false; // Reset for next session
    wsOpenRef.current = false;
    setConnectionStatus("disconnected");
    // ─── Clear singleton — this is an intentional disconnect ───
    debugLog("[Singleton] getConnectionStore()!.ws → null (from disconnect)");
    getConnectionStore()!.ws = null;
    getConnectionStore()!.socketState = "closing";
    getConnectionStore()!.isServerReady = false;
    getConnectionStore()!.conversationActive = false;
    getConnectionStore()!.reconnectAttempts = 0;
    if (ws.current) {
      debugLog("[State] socketState → closing (from disconnect)");
      setSocketState("closing");
      ws.current.close(1000, "User ended call"); // Code 1000 = intentional close, won't trigger reconnect
    }
  }, []);

  /**
   * Helper function to create a WAV header for raw PCM data
   */
  const createWavHeader = (
    data: ArrayBuffer,
    sampleRate: number,
    sampleBits: number
  ): ArrayBuffer => {
    const dataLength = data.byteLength;
    const buffer = new ArrayBuffer(44 + dataLength);
    const view = new DataView(buffer);

    const writeString = (offset: number, str: string) => {
      for (let i = 0; i < str.length; i++) {
        view.setUint8(offset + i, str.charCodeAt(i));
      }
    };

    const channels = 1;
    const byteRate = (sampleRate * channels * sampleBits) / 8;
    const blockAlign = (channels * sampleBits) / 8;

    writeString(0, "RIFF");
    view.setUint32(4, 36 + dataLength, true);
    writeString(8, "WAVE");
    writeString(12, "fmt ");
    view.setUint32(16, 16, true);
    view.setUint16(20, 1, true);
    view.setUint16(22, channels, true);
    view.setUint32(24, sampleRate, true);
    view.setUint32(28, byteRate, true);
    view.setUint16(32, blockAlign, true);
    view.setUint16(34, sampleBits, true);
    writeString(36, "data");
    view.setUint32(40, dataLength, true);

    // Copy the PCM data
    const pcm = new Uint8Array(data);
    const dataView = new Uint8Array(buffer, 44);
    dataView.set(pcm);

    return buffer;
  };

  /**
   * Send a text message (text chat mode — skips STT/TTS)
   */
  const sendText = useCallback((text: string) => {
    if (ws.current?.readyState === WebSocket.OPEN) {
      ws.current.send(JSON.stringify({ type: "text_message", text }));
      setTranscript({ role: "user", text });
    }
  }, []);

  const sendVoiceChange = useCallback((voice: string) => {
    if (ws.current?.readyState === WebSocket.OPEN) {
      ws.current.send(JSON.stringify({ type: "voice_change", voice }));
      debugLog(`[WS] Sent voice_change: ${voice}`);
    }
  }, []);

  return {
    connect,
    disconnect,
    startConversation,
    signalVisualReady,
    socketState,
    kiraState,
    micVolume,
    transcript,
    sendText,
    sendVoiceChange,
    error,
    isAudioBlocked,
    resumeAudio,
    isMuted,
    toggleMute,
    isScreenSharing,
    startScreenShare,
    stopScreenShare,
    isCameraActive,
    cameraStreamRef,
    facingMode,
    startCamera,
    stopCamera,
    flipCamera,
    isPro,
    remainingSeconds,
    isAudioPlaying,
    playerVolume,
    playbackAnalyserNode: playbackAnalyser.current,
    currentExpression,
    activeAccessories,
    currentAction,
    connectionStatus,
  };
};
