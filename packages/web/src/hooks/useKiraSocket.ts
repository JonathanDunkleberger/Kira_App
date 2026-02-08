"use client";
import { useState, useEffect, useRef, useCallback } from "react";
import { useSceneDetection } from "./useSceneDetection";

// Define the states
type SocketState = "idle" | "connecting" | "connected" | "closing" | "closed";
export type KiraState = "listening" | "thinking" | "speaking";

// Adaptive EOU: short utterances get snappy response, long utterances get patience for multi-part questions
const EOU_TIMEOUT_MIN = 500;   // 500ms silence for short utterances ("yes", "no", "hi")
const EOU_TIMEOUT_MAX = 1500;  // 1500ms silence for long multi-part questions
const LONG_UTTERANCE_FRAMES = 800; // ~2s of speech = "long utterance" (each frame ≈ 2.67ms at 48kHz)
const MIN_SPEECH_FRAMES_FOR_EOU = 50; // Must have ~50 speech frames to prevent junk utterances
const VAD_STABILITY_FRAMES = 5; // Need 5 consecutive speech frames before considering "speaking"

export const useKiraSocket = (token: string, guestId: string) => {
  const [socketState, setSocketState] = useState<SocketState>("idle");
  const [kiraState, setKiraState] = useState<KiraState>("listening");
  const kiraStateRef = useRef<KiraState>("listening"); // Ref to track state in callbacks

  // Sync ref with state
  useEffect(() => {
    kiraStateRef.current = kiraState;
  }, [kiraState]);

  const [micVolume, setMicVolume] = useState(0);
  const [playerVolume, setPlayerVolume] = useState(0);
  const [transcript, setTranscript] = useState<{ role: "user" | "ai"; text: string } | null>(null);

  const [error, setError] = useState<string | null>(null);
  const [isAudioBlocked, setIsAudioBlocked] = useState(false);
  const [isMuted, setIsMuted] = useState(false);
  const [isScreenSharing, setIsScreenSharing] = useState(false);
  const [isPro, setIsPro] = useState(false);
  const [remainingSeconds, setRemainingSeconds] = useState<number | null>(null);
  const ws = useRef<WebSocket | null>(null);
  const isServerReady = useRef(false); // Gate for sending audio

  // --- Audio Pipeline Refs ---
  const audioContext = useRef<AudioContext | null>(null);
  const audioWorkletNode = useRef<AudioWorkletNode | null>(null);
  const audioSource = useRef<MediaStreamAudioSourceNode | null>(null);
  const audioStream = useRef<MediaStream | null>(null);

  // --- Screen Share Refs ---
  const screenStream = useRef<MediaStream | null>(null);
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const isScreenSharingRef = useRef(false); // Ref to track screen share state in callbacks

  // --- Scene Detection ---
  const sceneBuffer = useSceneDetection({
    videoRef,
    enabled: isScreenSharing,
    checkInterval: 2000,
    threshold: 15
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

  const playbackContext = useRef<AudioContext | null>(null);
  const playbackSource = useRef<AudioBufferSourceNode | null>(null);
  const playbackAnalyser = useRef<AnalyserNode | null>(null);
  const playbackAnimationFrame = useRef<number | null>(null);

  // --- "Ramble Bot" EOU Timer ---
  const eouTimer = useRef<NodeJS.Timeout | null>(null);
  const maxUtteranceTimer = useRef<NodeJS.Timeout | null>(null);
  const speechFrameCount = useRef(0); // Track consecutive speech frames for VAD stability
  const totalSpeechFrames = useRef(0); // Total speech frames in current utterance (reset on EOU)
  const hasSpoken = useRef(false); // Whether user has spoken enough to trigger EOU

  // --- Vision: Snapshot Cooldown ---
  const lastSnapshotTime = useRef(0);
  const SNAPSHOT_COOLDOWN_MS = 5000; // One snapshot per 5 seconds max

  // --- WebSocket Auto-Reconnect ---
  const reconnectAttempts = useRef(0);
  const MAX_RECONNECT_ATTEMPTS = 5;

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
   * Visualizer loop
   */
  const startVisualizer = useCallback(() => {
    if (playbackAnimationFrame.current) return; // Already running

    const updateVolume = () => {
      if (!playbackAnalyser.current || !playbackContext.current) {
        playbackAnimationFrame.current = null;
        return;
      }

      // Stop visualizing only when:
      // 1. The queue is empty (no buffered chunks waiting)
      // 2. The server has confirmed no more chunks are coming (tts_chunk_ends received)
      // 3. All scheduled audio has finished playing (currentTime past nextStartTime)
      // This prevents the orb from going flat between sentence TTS chunks.
      if (
        audioQueue.current.length === 0 &&
        ttsChunksDone.current &&
        playbackContext.current.currentTime > nextStartTime.current + 0.5
      ) {
        // Don't snap to 0 — let it decay naturally via the asymmetric smoothing above
        // The CSS breathing handles the alive feel; this just needs to stop the loop
        playbackAnimationFrame.current = null;
        return;
      }

      const dataArray = new Uint8Array(playbackAnalyser.current.frequencyBinCount);
      playbackAnalyser.current.getByteFrequencyData(dataArray);
      
      // Calculate average volume
      let sum = 0;
      for (let i = 0; i < dataArray.length; i++) {
        sum += dataArray[i];
      }
      const average = sum / dataArray.length;
      // Normalize to 0-1 range (approximate)
      const rawVolume = Math.min(1, average / 128);
      
      // Asymmetric smoothing: fast attack for responsive peaks, slow decay for smooth fade
      setPlayerVolume((prev) => {
          if (rawVolume > prev) {
            // Fast attack — orb responds quickly to audio
            return prev * 0.6 + rawVolume * 0.4;
          } else {
            // Slow decay — orb fades gracefully between chunks
            return prev * 0.95 + rawVolume * 0.05;
          }
      });
      
      playbackAnimationFrame.current = requestAnimationFrame(updateVolume);
    };
    updateVolume();
  }, []);

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

    // 4. Stop visualizer
    if (playbackAnimationFrame.current) {
        cancelAnimationFrame(playbackAnimationFrame.current);
        playbackAnimationFrame.current = null;
        setPlayerVolume(0);
    }
    ttsChunksDone.current = true; // Reset for next turn
  }, []);

  /**
   * Processes the audio queue and schedules chunks to play back-to-back.
   * This eliminates gaps/pops caused by waiting for onended events.
   */
  const processAudioQueue = useCallback(async () => {
    if (isProcessingQueue.current) return;
    isProcessingQueue.current = true;

    // Ensure the playback audio context is running (and is 16kHz for Azure's output)
    if (
      !playbackContext.current ||
      playbackContext.current.state === "closed"
    ) {
      playbackContext.current = new AudioContext({ sampleRate: 16000 });
      playbackAnalyser.current = null; // Reset analyser if context is recreated
    }
    if (playbackContext.current.state === "suspended") {
      await playbackContext.current.resume();
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

        // 2. Create a source node
        const source = playbackContext.current.createBufferSource();
        source.buffer = audioBuffer;

        // Create Analyser for visualization if needed
        if (!playbackAnalyser.current) {
          playbackAnalyser.current = playbackContext.current.createAnalyser();
          playbackAnalyser.current.fftSize = 256;
          playbackAnalyser.current.connect(playbackContext.current.destination);
        }
        // Connect source -> analyser -> destination
        // Note: We already connected analyser -> destination above, so just source -> analyser
        source.connect(playbackAnalyser.current);

        // 3. Schedule playback
        const currentTime = playbackContext.current.currentTime;
        // If nextStartTime is in the past (gap in stream), reset to now + small buffer
        if (nextStartTime.current < currentTime) {
          nextStartTime.current = currentTime + 0.02;
        }

        source.start(nextStartTime.current);
        nextStartTime.current += audioBuffer.duration;

        // Keep track of the source so we can stop it later
        scheduledSources.current.push(source);
        source.onended = () => {
          // Remove from list when done to keep memory clean
          scheduledSources.current = scheduledSources.current.filter(s => s !== source);
        };

        // Keep track of the last source if we need to stop it manually later
        playbackSource.current = source;

        // Start visualizer if not running
        startVisualizer();

      } catch (e) {
        console.error("[AudioPlayer] Error decoding or playing audio:", e);
      }
    }

    isProcessingQueue.current = false;
  }, [startVisualizer]);

  const stopAudioPipeline = useCallback(() => {
    if (eouTimer.current) clearTimeout(eouTimer.current);

    audioWorkletNode.current?.port.close();
    audioSource.current?.disconnect();
    audioStream.current?.getTracks().forEach((track) => track.stop());
    screenStream.current?.getTracks().forEach((track) => track.stop()); // Stop screen share
    audioContext.current?.close().catch(console.error);
    playbackContext.current?.close().catch(console.error);

    audioWorkletNode.current = null;
    audioSource.current = null;
    audioStream.current = null;
    audioContext.current = null;
    playbackContext.current = null;
    playbackAnalyser.current = null; // Ensure analyser is cleared so it's recreated with new context

    console.log("[Audio] 🛑 Audio pipeline stopped.");
  }, []);

  /**
   * Initializes audio contexts and requests mic permission.
   * Must be called from a user gesture.
   */
  const initializeAudio = useCallback(async () => {
    try {
      console.log("[Audio] Initializing audio contexts...");
      
      // 1. Create/Resume AudioContext
      if (!audioContext.current || audioContext.current.state === "closed") {
        audioContext.current = new AudioContext();
      }
      if (audioContext.current.state === "suspended") {
        await audioContext.current.resume();
      }

      // 2. Create/Resume PlaybackContext
      if (!playbackContext.current || playbackContext.current.state === "closed") {
        playbackContext.current = new AudioContext({ sampleRate: 16000 });
      }
      if (playbackContext.current.state === "suspended") {
        await playbackContext.current.resume();
      }

      // 3. Request Mic Permission (if not already)
      if (!audioStream.current) {
        console.log("[Audio] Requesting mic permission...");
        audioStream.current = await navigator.mediaDevices.getUserMedia({
          audio: {
            channelCount: 1,
            echoCancellation: true,
            autoGainControl: true,
            noiseSuppression: true,
          },
        });
        console.log("[Audio] Mic permission granted.");
      }

      setIsAudioBlocked(false);
      return true;
    } catch (err) {
      console.error("[Audio] Failed to initialize audio:", err);
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

      console.log("[Vision] Screen share started");
      
      // Send an initial snapshot immediately to establish context
      setTimeout(() => {
          const snapshot = captureScreenSnapshot();
          if (snapshot && ws.current?.readyState === WebSocket.OPEN) {
              console.log("[Vision] Sending initial snapshot...");
              // Send buffer + current frame
              const payload = {
                  type: "image",
                  images: [...sceneBufferRef.current, snapshot]
              };
              ws.current.send(JSON.stringify(payload));
          } else {
              console.warn("[Vision] Failed to capture initial snapshot.");
          }
      }, 1000);

    } catch (err) {
      console.error("[Vision] Failed to start screen share:", err);
      setIsScreenSharing(false);
    }
  }, []);

  /**
   * Stops screen sharing
   */
  const stopScreenShare = useCallback(() => {
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
    console.log("[Vision] Screen share stopped");
  }, []);

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
      console.error("[Audio] WebSocket not open, cannot start pipeline.");
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
      
      console.log("[Audio] Loading AudioWorklet module...");
      try {
        // Use a robust path for the worklet
        const workletUrl = "/worklets/AudioWorkletProcessor.js";
        // Check if module is already added (not directly possible, but addModule is idempotent-ish or throws)
        // We'll just try adding it.
        await audioContext.current.audioWorklet.addModule(workletUrl);
        console.log("[Audio] AudioWorklet module loaded.");
      } catch (e) {
        // Ignore error if module already added (DOMException)
        console.log("[Audio] Worklet might already be loaded:", e);
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
               console.log("[AudioWorklet]", event.data.message);
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
                if (speechFrameCount.current === (VAD_STABILITY_FRAMES + 1) && isScreenSharingRef.current) {
                    const now = Date.now();
                    if (now - lastSnapshotTime.current > SNAPSHOT_COOLDOWN_MS) {
                        lastSnapshotTime.current = now;
                        console.log("[Vision] Speech start detected while screen sharing. Attempting capture...");
                        const snapshot = captureScreenSnapshot();
                        if (snapshot) {
                            console.log("[Vision] Sending snapshot on speech start...");
                            const payload = {
                                type: "image",
                                images: [...sceneBufferRef.current, snapshot]
                            };
                            ws.current.send(JSON.stringify(payload));
                        } else {
                            console.warn("[Vision] Snapshot capture returned null.");
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
                    console.log("[EOU] Max utterance length reached. Forcing EOU.");
                    if (ws.current?.readyState === WebSocket.OPEN) {
                      ws.current.send(JSON.stringify({ type: "eou" }));
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
                    console.log(`[EOU] Silence detected after speech (${totalSpeechFrames.current} speech frames, timeout: ${adaptiveTimeout}ms), sending End of Utterance.`);
                    if (ws.current?.readyState === WebSocket.OPEN) {
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
      
      console.log("[Audio] Connecting mic to worklet...");
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

      console.log("[Audio] ✅ Audio pipeline started.");
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
    console.log("[UI] Start button clicked.");
    if (ws.current && ws.current.readyState === WebSocket.OPEN) {
      console.log("[WS] Sending 'start_stream' message...");
      try {
        ws.current.send(JSON.stringify({ type: "start_stream" }));
      } catch (err) {
        console.error("[WS] Failed to send start_stream:", err);
      }
      
      // Start mic immediately to satisfy browser user-gesture requirements
      console.log("[Audio] Starting local audio pipeline...");
      startAudioPipeline();
    } else {
      console.error(
        "[WS] Cannot start stream: WebSocket is not open or not connected."
      );
    }
  }, [startAudioPipeline]);

  /**
   * Explicitly resume audio contexts.
   * Call this from a user gesture (click/tap) if audio is blocked.
   */
  const resumeAudio = useCallback(async () => {
    await initializeAudio();
  }, [initializeAudio]);

  /**
   * Main connection logic
   */
  const connect = useCallback(async () => {
    if (ws.current) return;

    // Initialize Audio IMMEDIATELY (Synchronously inside gesture if possible)
    await initializeAudio();

    const wsUrl = process.env.NEXT_PUBLIC_WEBSOCKET_URL!;
    const authParam = token ? `token=${token}` : `guestId=${guestId}`;

    setSocketState("connecting");
    isServerReady.current = false;
    ws.current = new WebSocket(`${wsUrl}?${authParam}`);
    ws.current.binaryType = "arraybuffer"; // We are sending and receiving binary

    ws.current.onopen = () => {
      setSocketState("connected");
      reconnectAttempts.current = 0; // Reset on successful connection
      setError(null); // Clear any error banner from a previous disconnect
      console.log("[WS] ✅ WebSocket connected.");
      // Auto-start the conversation and mic pipeline as soon as socket is open
      startConversation();
    };

    ws.current.onmessage = (event) => {
      if (typeof event.data === "string") {
        // This is a JSON control message
        const msg = JSON.parse(event.data);

        switch (msg.type) {
          case "session_config":
            console.log("[WS] Received session config:", msg);
            setIsPro(msg.isPro);
            if (msg.remainingSeconds !== undefined) {
              setRemainingSeconds(msg.remainingSeconds);
            }
            break;
          case "stream_ready":
            console.log("[WS] Received stream_ready.");
            setKiraState("listening");
            isServerReady.current = true;
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
            audioQueue.current = []; // Clear old queue
            nextStartTime.current = 0; // Reset scheduling time
            ttsChunksDone.current = false; // CRITICAL: Prevent visualizer from self-terminating before audio arrives
            break;
          case "state_listening":
            kiraStateRef.current = "listening";
            setKiraState("listening");
            break;
          case "transcript":
            setTranscript({ role: msg.role, text: msg.text });
            break;
          case "tts_chunk_starts":
            ttsChunksDone.current = false; // More audio chunks incoming
            break;
          case "tts_chunk_ends":
            // The server is done sending audio for this turn
            ttsChunksDone.current = true; // Visualizer can now self-terminate when queue drains
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
              console.warn("[WS] Daily limit reached.");
              setError("limit_reached"); // Special error code for UI
            } else {
              console.error("[WS] Server error:", msg.message);
              setError(msg.message);
            }
            break;
        }
      } else if (event.data instanceof ArrayBuffer) {
        // This is a raw PCM audio chunk from Azure
        // Only process audio if we are in 'speaking' state.
        // If we are 'listening' (e.g. due to interruption), we drop these packets.
        if (kiraStateRef.current === "speaking") {
            audioQueue.current.push(event.data);
            processAudioQueue();
        }
      }
    };

    ws.current.onclose = (event) => {
      console.log(`[WS] 🔌 Connection closed: ${event.code} - ${event.reason}`);
      setSocketState("closed");
      
      if (event.code === 1008) {
        setError("limit_reached");
      }

      stopAudioPipeline();
      ws.current = null;
      isServerReady.current = false; // Prevent stale audio sends on reconnect

      // Auto-reconnect on unexpected closes (not user-initiated or auth failure)
      if (event.code !== 1000 && event.code !== 1008 && reconnectAttempts.current < MAX_RECONNECT_ATTEMPTS) {
        const delay = Math.min(1000 * Math.pow(2, reconnectAttempts.current), 10000);
        reconnectAttempts.current++;
        console.log(`[WS] Reconnecting in ${delay}ms (attempt ${reconnectAttempts.current}/${MAX_RECONNECT_ATTEMPTS})...`);
        setTimeout(() => {
          connect();
        }, delay);
      } else if (event.code !== 1000 && event.code !== 1008) {
        // All reconnect attempts exhausted — show error to user
        setError("Connection lost. Please refresh the page.");
      }
    };

    ws.current.onerror = (err) => {
      console.error("[WS] ❌ WebSocket error:", err);
      setSocketState("closed");
      stopAudioPipeline();
      // Don't set error here — onclose will handle reconnection or final error
    };
  }, [token, guestId, startConversation, processAudioQueue, stopAudioPipeline]);

  const disconnect = useCallback(() => {
    if (eouTimer.current) clearTimeout(eouTimer.current);
    reconnectAttempts.current = MAX_RECONNECT_ATTEMPTS; // Prevent any reconnection
    if (ws.current) {
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

  return {
    connect,
    disconnect,
    startConversation,
    socketState,
    kiraState,
    micVolume,
    playerVolume,
    transcript,
    sendText,
    error,
    isAudioBlocked,
    resumeAudio,
    isMuted,
    toggleMute,
    isScreenSharing,
    startScreenShare,
    stopScreenShare,
    isPro,
    remainingSeconds
  };
};
