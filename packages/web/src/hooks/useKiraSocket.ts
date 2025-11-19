"use client";
import { useState, useEffect, useRef } from "react";

// Define the states
type SocketState = "idle" | "connecting" | "connected" | "closing" | "closed";
export type KiraState = "listening" | "thinking" | "speaking";

const EOU_TIMEOUT = 2000; // Increased to 2 seconds to prevent premature cutoff

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
  const ws = useRef<WebSocket | null>(null);
  const isServerReady = useRef(false); // Gate for sending audio

  // --- Audio Pipeline Refs ---
  const audioContext = useRef<AudioContext | null>(null);
  const audioWorkletNode = useRef<AudioWorkletNode | null>(null);
  const audioSource = useRef<MediaStreamAudioSourceNode | null>(null);
  const audioStream = useRef<MediaStream | null>(null);

  // --- Audio Playback Refs ---
  const audioQueue = useRef<ArrayBuffer[]>([]);
  const isPlaying = useRef(false);
  const nextStartTime = useRef(0); // Track where the next chunk should start
  const isProcessingQueue = useRef(false); // Lock for the processing loop
  const scheduledSources = useRef<AudioBufferSourceNode[]>([]); // Track all scheduled sources

  const playbackContext = useRef<AudioContext | null>(null);
  const playbackSource = useRef<AudioBufferSourceNode | null>(null);
  const playbackAnalyser = useRef<AnalyserNode | null>(null);
  const playbackAnimationFrame = useRef<number | null>(null);

  // --- "Ramble Bot" EOU Timer ---
  const eouTimer = useRef<NodeJS.Timeout | null>(null);
  const maxUtteranceTimer = useRef<NodeJS.Timeout | null>(null);
  const speechFrameCount = useRef(0); // Track consecutive speech frames for VAD stability

  /**
   * Visualizer loop
   */
  const startVisualizer = () => {
    if (playbackAnimationFrame.current) return; // Already running

    const updateVolume = () => {
      if (!playbackAnalyser.current || !playbackContext.current) {
        playbackAnimationFrame.current = null;
        return;
      }

      // Stop visualizing if there are no scheduled sources and the queue is empty.
      // This is more robust than checking time, as it tracks actual active nodes.
      if (
        scheduledSources.current.length === 0 &&
        audioQueue.current.length === 0
      ) {
        setPlayerVolume(0);
        playbackAnimationFrame.current = null;
        return; // Stop the loop
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
      
      // Smooth the player volume
      setPlayerVolume((prev) => {
          const smoothingFactor = 0.3;
          return prev * (1 - smoothingFactor) + rawVolume * smoothingFactor;
      });
      
      playbackAnimationFrame.current = requestAnimationFrame(updateVolume);
    };
    updateVolume();
  };

  /**
   * Stops current audio playback and clears the queue.
   */
  const stopAudioPlayback = () => {
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
  };

  /**
   * Processes the audio queue and schedules chunks to play back-to-back.
   * This eliminates gaps/pops caused by waiting for onended events.
   */
  const processAudioQueue = async () => {
    if (isProcessingQueue.current) return;
    isProcessingQueue.current = true;

    // Ensure the playback audio context is running (and is 16kHz for Azure's output)
    if (
      !playbackContext.current ||
      playbackContext.current.state === "closed"
    ) {
      playbackContext.current = new AudioContext({ sampleRate: 16000 });
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
          nextStartTime.current = currentTime + 0.05;
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
  };

  const stopAudioPipeline = () => {
    if (eouTimer.current) clearTimeout(eouTimer.current);

    audioWorkletNode.current?.port.close();
    audioSource.current?.disconnect();
    audioStream.current?.getTracks().forEach((track) => track.stop());
    audioContext.current?.close().catch(console.error);
    playbackContext.current?.close().catch(console.error);

    audioWorkletNode.current = null;
    audioSource.current = null;
    audioStream.current = null;
    audioContext.current = null;
    playbackContext.current = null;
    playbackAnalyser.current = null; // Ensure analyser is cleared so it's recreated with new context

    console.log("[Audio] 🛑 Audio pipeline stopped.");
  };

  /**
   * Initializes and starts the audio capture pipeline (Mic -> Worklet -> WebSocket)
   */
  const startAudioPipeline = async () => {
    if (!ws.current || ws.current.readyState !== WebSocket.OPEN) {
      console.error("[Audio] WebSocket not open, cannot start pipeline.");
      return;
    }

    try {
      // 1. Get Mic permission
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

      // 2. Create AudioContext and load our custom processor
      if (!audioContext.current || audioContext.current.state === "closed") {
        console.log("[Audio] Creating new AudioContext...");
        audioContext.current = new AudioContext();
      }
      console.log(`[Audio] AudioContext state: ${audioContext.current.state}`);
      
      if (audioContext.current.state === "suspended") {
        console.log("[Audio] Resuming AudioContext...");
        await audioContext.current.resume();
      }

      console.log("[Audio] Loading AudioWorklet module...");
      try {
        // Use a robust path for the worklet
        const workletUrl = "/worklets/AudioWorkletProcessor.js";
        await audioContext.current.audioWorklet.addModule(workletUrl);
        console.log("[Audio] AudioWorklet module loaded.");
      } catch (e) {
        console.error("[Audio] Failed to load AudioWorklet:", e);
        throw e;
      }

      // 3. Create the Worklet Node
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

      // 4. Connect the Mic to the Worklet
      console.log("[Audio] Connecting mic to worklet...");
      audioSource.current = audioContext.current.createMediaStreamSource(
        audioStream.current
      );
      audioSource.current.connect(audioWorkletNode.current);

      // WORKAROUND: Connect worklet to a silent destination to force the graph to run
      // (Chrome sometimes suspends nodes that aren't connected to destination)
      const silentGain = audioContext.current.createGain();
      silentGain.gain.value = 0;
      audioWorkletNode.current.connect(silentGain);
      silentGain.connect(audioContext.current.destination);

      // 5. Connect the Worklet to the main app (this hook)
      audioWorkletNode.current.port.onmessage = (event) => {
        // Handle Debug Messages from Worklet
        if (event.data && event.data.type === "debug") {
           console.log("[AudioWorklet]", event.data.message);
           return;
        }

        // We received a 16-bit PCM buffer from the worklet
        const pcmBuffer = event.data as ArrayBuffer;

        // Calculate Mic Volume (RMS)
        const pcmData = new Int16Array(pcmBuffer);
        let sum = 0;
        for (let i = 0; i < pcmData.length; i++) {
          sum += pcmData[i] * pcmData[i];
        }
        const rms = Math.sqrt(sum / pcmData.length);
        // Normalize (16-bit max is 32768)
        // Multiply by a factor to make it more sensitive visually
        const rawVolume = Math.min(1, (rms / 32768) * 5);
        
        // Smooth the volume (Linear Interpolation)
        // We use a ref to track the previous smoothed volume since state updates are async
        // But here we are inside an event handler, so we can just use the state setter with a callback
        // actually, using a ref for the "current displayed volume" is better for the loop, 
        // but here we are setting state for the UI.
        // Let's just smooth it against the previous state.
        setMicVolume((prev) => {
            const smoothingFactor = 0.3; // 0.0 = no change, 1.0 = instant
            return prev * (1 - smoothingFactor) + rawVolume * smoothingFactor;
        });

        // Debug log to verify mic input
        if (Math.random() < 0.05) { // Log ~5% of frames to avoid spam
           console.log(`[Audio] Mic RMS: ${rms.toFixed(2)}, Vol: ${rawVolume.toFixed(2)}`);
        }

        if (
          ws.current?.readyState === WebSocket.OPEN &&
          kiraStateRef.current === "listening" &&
          isServerReady.current
        ) {
          ws.current.send(pcmBuffer);

          // VAD & EOU Logic
          // We only reset the EOU timer if the user is actually speaking (RMS > threshold).
          // Otherwise, we let the timer run (or start it if not running).
          const VAD_THRESHOLD = 1500; // Lowered from 2000 to be more responsive to interruptions
          const isSpeakingFrame = rms > VAD_THRESHOLD;

          if (isSpeakingFrame) {
            speechFrameCount.current++;
          } else {
            speechFrameCount.current = 0;
          }

          // Only consider it "speaking" if we have 3 consecutive frames above threshold
          // This prevents short clicks/pops from triggering interruption
          const isSpeaking = speechFrameCount.current > 3;

          if (isSpeaking) {
            // User is speaking: Cancel any pending EOU
            if (eouTimer.current) {
              clearTimeout(eouTimer.current);
              eouTimer.current = null;
            }

            // Interruption: If AI is speaking or thinking, stop it and notify server.
            const currentState = kiraStateRef.current as KiraState;
            // Also check if we are currently playing audio (even if state says listening)
            const isAudioPlaying = scheduledSources.current.length > 0 || audioQueue.current.length > 0;

            if (currentState === "speaking" || currentState === "thinking" || isAudioPlaying) {
               stopAudioPlayback();
               // Force local state to listening immediately to prevent processing "zombie" audio packets
               setKiraState("listening");
               kiraStateRef.current = "listening"; // Update ref immediately to avoid race conditions
               
               // Send interrupt signal. The server will reset state to 'listening'.
               // We check state to avoid spamming this message every frame.
               ws.current.send(JSON.stringify({ type: "interrupt" }));
            }

            // Start Max Utterance Timer if not running
            if (!maxUtteranceTimer.current) {
              maxUtteranceTimer.current = setTimeout(() => {
                console.log("[EOU] Max utterance length reached. Forcing EOU.");
                if (ws.current?.readyState === WebSocket.OPEN) {
                  ws.current.send(JSON.stringify({ type: "eou" }));
                }
                // Reset timers
                if (eouTimer.current) clearTimeout(eouTimer.current);
                eouTimer.current = null;
                maxUtteranceTimer.current = null;
              }, 10000); // 10 seconds limit
            }
          } else {
            // User is silent: Start EOU timer if not already running
            if (!eouTimer.current) {
              eouTimer.current = setTimeout(() => {
                console.log("[EOU] Silence detected, sending End of Utterance.");
                if (ws.current?.readyState === WebSocket.OPEN) {
                  ws.current.send(JSON.stringify({ type: "eou" }));
                }
                // We don't clear eouTimer.current here immediately to prevent rapid re-firing
                // But actually, we want to allow re-firing if they speak again.
                // For now, let's just clear it so it can restart if silence continues (server handles spam)
                eouTimer.current = null;

                // Also clear max utterance timer since we finished naturally
                if (maxUtteranceTimer.current) {
                  clearTimeout(maxUtteranceTimer.current);
                  maxUtteranceTimer.current = null;
                }
              }, EOU_TIMEOUT);
            }
          }
        }
      };

      console.log("[Audio] ✅ Audio pipeline started.");
    } catch (err) {
      console.error("[Audio] ❌ Failed to start audio pipeline:", err);
      setError("Microphone access denied or failed. Please check permissions.");
    }
  };



  /**
   * Main connection logic
   */
  const connect = async () => {
    if (ws.current) return;

    // Mobile Safari Audio Unlock:
    // Create and resume contexts inside this user-gesture (click) event.
    try {
      if (!audioContext.current || audioContext.current.state === "closed") {
        audioContext.current = new AudioContext();
      }
      if (audioContext.current.state === "suspended") {
        await audioContext.current.resume();
      }

      if (
        !playbackContext.current ||
        playbackContext.current.state === "closed"
      ) {
        playbackContext.current = new AudioContext({ sampleRate: 16000 });
      }
      if (playbackContext.current.state === "suspended") {
        await playbackContext.current.resume();
      }
    } catch (err) {
      console.error("[Audio] Failed to unlock audio contexts:", err);
    }

    const wsUrl = process.env.NEXT_PUBLIC_WEBSOCKET_URL!;
    const authParam = token ? `token=${token}` : `guestId=${guestId}`;

    setSocketState("connecting");
    isServerReady.current = false;
    ws.current = new WebSocket(`${wsUrl}?${authParam}`);
    ws.current.binaryType = "arraybuffer"; // We are sending and receiving binary

    ws.current.onopen = () => {
      setSocketState("connected");
      console.log("[WS] ✅ WebSocket connected.");
      // Auto-start the conversation and mic pipeline as soon as socket is open
      startConversation();
    };

    ws.current.onmessage = (event) => {
      if (typeof event.data === "string") {
        // This is a JSON control message
        const msg = JSON.parse(event.data);

        switch (msg.type) {
          case "stream_ready":
            console.log("[WS] Received stream_ready.");
            setKiraState("listening");
            isServerReady.current = true;
            break;
          case "state_thinking":
            if (eouTimer.current) clearTimeout(eouTimer.current); // Stop EOU timer
            setKiraState("thinking");
            break;
          case "state_speaking":
            setKiraState("speaking");
            audioQueue.current = []; // Clear old queue
            nextStartTime.current = 0; // Reset scheduling time
            break;
          case "state_listening":
            setKiraState("listening");
            break;
          case "transcript":
            setTranscript({ role: msg.role, text: msg.text });
            break;
          case "tts_chunk_starts":
            break;
          case "tts_chunk_ends":
            // The server is done sending audio for this turn
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
      setError(`Connection closed (Code: ${event.code})`);
      stopAudioPipeline();
      ws.current = null;
    };

    ws.current.onerror = (err) => {
      console.error("[WS] ❌ WebSocket error:", err);
      setSocketState("closed");
      setError("WebSocket connection error");
      stopAudioPipeline();
    };
  };

  const disconnect = () => {
    if (eouTimer.current) clearTimeout(eouTimer.current);
    if (ws.current) {
      setSocketState("closing");
      ws.current.close();
    }
  };

  /**
   * Explicitly start the conversation: send start_stream and start mic pipeline.
   * Adds detailed logs to trace user action and pipeline startup.
   */
  const startConversation = () => {
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
  };

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

  return {
    connect,
    disconnect,
    startConversation,
    socketState,
    kiraState,
    micVolume,
    playerVolume,
    transcript,
    error,
  };
};
