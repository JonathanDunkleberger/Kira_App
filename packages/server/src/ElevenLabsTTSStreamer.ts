// ElevenLabs TTS streaming via their WebSocket API.
// Synthesizes text and emits audio chunks, matching the same
// event interface as AzureTTSStreamer (audio_chunk, tts_complete, error).
//
// Output format: Raw 16kHz 16-bit mono PCM — matches Azure's output
// so the client audio pipeline works identically for both voices.

import { EventEmitter } from "events";
import WebSocket from "ws";

const ELEVEN_LABS_API_KEY = process.env.ELEVEN_LABS_API_KEY!;
const VOICE_ID = process.env.ELEVEN_LABS_VOICE_ID || "BZgkqPqms7Kj9ulSkVzn";
const MODEL_ID = process.env.ELEVEN_LABS_MODEL || "eleven_turbo_v2_5";
const STABILITY = parseFloat(process.env.ELEVEN_LABS_STABILITY || "0.5");
const SIMILARITY_BOOST = parseFloat(process.env.ELEVEN_LABS_SIMILARITY_BOOST || "0.75");

export class ElevenLabsTTSStreamer extends EventEmitter {
  async synthesize(text: string): Promise<void> {
    return new Promise<void>((resolve, reject) => {
      let resolved = false;
      const url = `wss://api.elevenlabs.io/v1/text-to-speech/${VOICE_ID}/stream-input?model_id=${MODEL_ID}&output_format=pcm_16000`;

      const socket = new WebSocket(url, {
        headers: {
          "xi-api-key": ELEVEN_LABS_API_KEY,
        },
      });

      const done = () => {
        if (resolved) return;
        resolved = true;
        this.emit("tts_complete");
        try { socket.close(); } catch (_) { /* ignore */ }
        resolve();
      };

      socket.on("open", () => {
        console.log(`[ElevenLabs] WebSocket connected. Voice: ${VOICE_ID}, Model: ${MODEL_ID}`);
        // Send initial config with voice settings
        socket.send(JSON.stringify({
          text: " ",
          voice_settings: {
            stability: STABILITY,
            similarity_boost: SIMILARITY_BOOST,
            use_speaker_boost: true,
          },
          generation_config: {
            flush: true,
          },
        }));

        // Send the actual text
        socket.send(JSON.stringify({
          text: text,
          flush: true,
        }));

        // Signal end of input
        socket.send(JSON.stringify({
          text: "",
        }));
      });

      socket.on("message", (data: Buffer | string) => {
        try {
          const msg = JSON.parse(data.toString());

          if (msg.audio) {
            // ElevenLabs sends base64-encoded audio
            const audioBuffer = Buffer.from(msg.audio, "base64");
            this.emit("audio_chunk", audioBuffer);
          }

          if (msg.isFinal) {
            done();
          }
        } catch (_) {
          // Binary audio data — emit directly
          if (Buffer.isBuffer(data)) {
            this.emit("audio_chunk", data);
          }
        }
      });

      socket.on("error", (err: Error) => {
        console.error("[ElevenLabs] WebSocket error:", err.message);
        this.emit("error", err);
        try { socket.close(); } catch (_) { /* ignore */ }
        if (!resolved) {
          resolved = true;
          reject(err);
        }
      });

      socket.on("close", () => {
        done();
      });
    });
  }
}
