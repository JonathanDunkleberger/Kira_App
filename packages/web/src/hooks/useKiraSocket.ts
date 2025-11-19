"use client";
import { useState, useEffect, useRef } from "react";

// Define the states
type SocketState = "idle" | "connecting" | "connected" | "closing" | "closed";
export type KiraState = "listening" | "thinking" | "speaking";

const EOU_TIMEOUT = 1000; // 1 second of silence = end of utterance

export const useKiraSocket = (token: string, guestId: string) => {
  const [socketState, setSocketState] = useState<SocketState>("idle");
  const [kiraState, setKiraState] = useState<KiraState>("listening");
  const [micVolume, setMicVolume] = useState(0);
  const [playerVolume, setPlayerVolume] = useState(0);
  const [transcript, setTranscript] = useState<{ role: "user" | "ai"; text: string } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const ws = useRef<WebSocket | null>(null);

  // --- Audio Pipeline Refs ---
  const audioContext = useRef<AudioContext | null>(null);
  const audioWorkletNode = useRef<AudioWorkletNode | null>(null);
  const audioSource = useRef<MediaStreamAudioSourceNode | null>(null);
  const audioStream = useRef<MediaStream | null>(null);

  // --- Audio Playback Refs ---
  const audioQueue = useRef<ArrayBuffer[]>([]);
  const isPlaying = useRef(false);
  const playbackContext = useRef<AudioContext | null>(null);
  const playbackSource = useRef<AudioBufferSourceNode | null>(null);
  const playbackAnalyser = useRef<AnalyserNode | null>(null);
  const playbackAnimationFrame = useRef<number | null>(null);

  // --- "Ramble Bot" EOU Timer ---
  const eouTimer = useRef<NodeJS.Timeout | null>(null);

  /**
   * Plays the next audio chunk from the queue.
   * This logic is more robust and handles raw PCM.
   */
  const playNextInQueue = async () => {
    if (isPlaying.current || audioQueue.current.length === 0) {
      return;
    }

    isPlaying.current = true;

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

    const buffer = audioQueue.current.shift();
    if (!buffer) {
      isPlaying.current = false;
      return;
    }

    try {
      // 1. Decode the raw PCM buffer
      // We must construct a valid WAV header in memory for decodeAudioData to work
      const wavBuffer = createWavHeader(buffer, 16000, 16);
      const audioBuffer = await playbackContext.current.decodeAudioData(
        wavBuffer
      );

      // 2. Create a source node and play it
      playbackSource.current = playbackContext.current.createBufferSource();
      playbackSource.current.buffer = audioBuffer;

      // Create Analyser for visualization
      if (!playbackAnalyser.current) {
        playbackAnalyser.current = playbackContext.current.createAnalyser();
        playbackAnalyser.current.fftSize = 256;
      }

      playbackSource.current.connect(playbackAnalyser.current);
      playbackAnalyser.current.connect(playbackContext.current.destination);

      // Start visualizer loop
      const updateVolume = () => {
        if (!playbackAnalyser.current || !isPlaying.current) return;
        const dataArray = new Uint8Array(playbackAnalyser.current.frequencyBinCount);
        playbackAnalyser.current.getByteFrequencyData(dataArray);
        
        // Calculate average volume
        let sum = 0;
        for (let i = 0; i < dataArray.length; i++) {
          sum += dataArray[i];
        }
        const average = sum / dataArray.length;
        // Normalize to 0-1 range (approximate)
        setPlayerVolume(Math.min(1, average / 128));
        
        playbackAnimationFrame.current = requestAnimationFrame(updateVolume);
      };
      updateVolume();

      playbackSource.current.onended = () => {
        isPlaying.current = false;
        if (playbackAnimationFrame.current) {
          cancelAnimationFrame(playbackAnimationFrame.current);
        }
        setPlayerVolume(0);
        playNextInQueue(); // Play next chunk when this one finishes
      };

      playbackSource.current.start();
    } catch (e) {
      console.error("[AudioPlayer] Error decoding or playing audio:", e);
      isPlaying.current = false;
    }
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
        await audioContext.current.audioWorklet.addModule(
          "/worklets/AudioWorkletProcessor.js"
        );
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
        const normalizedVolume = Math.min(1, (rms / 32768) * 5);
        setMicVolume(normalizedVolume);

        // Debug log to verify mic input
        if (Math.random() < 0.05) { // Log ~5% of frames to avoid spam
           console.log(`[Audio] Mic RMS: ${rms.toFixed(2)}, Vol: ${normalizedVolume.toFixed(2)}`);
        }

        if (
          ws.current?.readyState === WebSocket.OPEN &&
          kiraState === "listening"
        ) {
          ws.current.send(pcmBuffer);

          // VAD & EOU Logic
          // We only reset the EOU timer if the user is actually speaking (RMS > threshold).
          // Otherwise, we let the timer run (or start it if not running).
          const VAD_THRESHOLD = 400; // Adjust based on mic noise floor
          const isSpeaking = rms > VAD_THRESHOLD;

          if (isSpeaking) {
            // User is speaking: Cancel any pending EOU
            if (eouTimer.current) {
              clearTimeout(eouTimer.current);
              eouTimer.current = null;
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

    console.log("[Audio] 🛑 Audio pipeline stopped.");
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
            break;
          case "state_thinking":
            if (eouTimer.current) clearTimeout(eouTimer.current); // Stop EOU timer
            setKiraState("thinking");
            break;
          case "state_speaking":
            setKiraState("speaking");
            audioQueue.current = []; // Clear old queue
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
        audioQueue.current.push(event.data);
        playNextInQueue();
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
