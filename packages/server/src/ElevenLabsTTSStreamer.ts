import { EventEmitter } from "events";
import WebSocket from "ws";

const ELEVEN_LABS_API_KEY = process.env.ELEVEN_LABS_API_KEY!;
const VOICE_ID = process.env.ELEVEN_LABS_VOICE_ID || "m3yAHyFEFKtbCIM5n7GF";
const MODEL_ID = process.env.ELEVEN_LABS_MODEL || "eleven_turbo_v2_5";

export class ElevenLabsTTSStreamer extends EventEmitter {
  private ws: any = null;

  async synthesize(text: string): Promise<void> {
    return new Promise<void>((resolve, reject) => {
      if (!ELEVEN_LABS_API_KEY) {
        console.error("[ElevenLabs] API key is MISSING. Cannot synthesize.");
        this.emit("tts_complete");
        resolve();
        return;
      }

      const stability = parseFloat(process.env.ELEVEN_LABS_STABILITY || "0.5");
      const similarityBoost = parseFloat(process.env.ELEVEN_LABS_SIMILARITY_BOOST || "0.75");

      const url = `wss://api.elevenlabs.io/v1/text-to-speech/${VOICE_ID}/stream-input?model_id=${MODEL_ID}&output_format=pcm_16000`;

      console.log(`[ElevenLabs] Connecting — Voice: ${VOICE_ID}, Model: ${MODEL_ID}`);
      console.log(`[ElevenLabs] Text to synthesize: "${text}"`);

      let resolved = false;
      let audioChunkCount = 0;
      let totalAudioBytes = 0;

      // Safety timeout — if nothing happens in 15 seconds, give up
      const safetyTimeout = setTimeout(() => {
        if (!resolved) {
          console.warn(`[ElevenLabs] Safety timeout (15s). Chunks received: ${audioChunkCount}, bytes: ${totalAudioBytes}`);
          resolved = true;
          this.emit("tts_complete");
          this.cleanup();
          resolve();
        }
      }, 15000);

      const finish = () => {
        if (!resolved) {
          resolved = true;
          clearTimeout(safetyTimeout);
          console.log(`[ElevenLabs] Done. Total chunks: ${audioChunkCount}, bytes: ${totalAudioBytes}`);
          this.emit("tts_complete");
          this.cleanup();
          resolve();
        }
      };

      let sock: any;
      try {
        sock = new WebSocket(url, {
          headers: {
            "xi-api-key": ELEVEN_LABS_API_KEY,
          },
        });
        this.ws = sock;
      } catch (err) {
        console.error("[ElevenLabs] Failed to create WebSocket:", (err as Error).message);
        clearTimeout(safetyTimeout);
        this.emit("tts_complete");
        resolve();
        return;
      }

      sock.on("open", () => {
        console.log("[ElevenLabs] WebSocket connected.");

        // Send BOS (beginning of stream) with voice settings
        const bosMessage = JSON.stringify({
          text: " ",
          voice_settings: {
            stability: stability,
            similarity_boost: similarityBoost,
            use_speaker_boost: true,
          },
          generation_config: {
            flush: true,
          },
        });
        console.log(`[ElevenLabs] Sending BOS: ${bosMessage}`);
        sock.send(bosMessage);

        // Send the actual text
        const textMessage = JSON.stringify({
          text: text,
          flush: true,
        });
        console.log(`[ElevenLabs] Sending text: ${textMessage}`);
        sock.send(textMessage);

        // Send EOS (end of stream)
        const eosMessage = JSON.stringify({ text: "" });
        console.log("[ElevenLabs] Sending EOS");
        sock.send(eosMessage);
      });

      sock.on("message", (data: Buffer | string) => {
        try {
          const str = typeof data === "string" ? data : data.toString("utf-8");
          const msg = JSON.parse(str);

          // Log every message type we receive
          const keys = Object.keys(msg);
          console.log(`[ElevenLabs] Received message — keys: [${keys.join(", ")}]`);

          if (msg.error) {
            console.error(`[ElevenLabs] API ERROR: ${JSON.stringify(msg.error)}`);
            finish();
            return;
          }

          if (msg.audio) {
            const audioBuffer = Buffer.from(msg.audio, "base64");
            audioChunkCount++;
            totalAudioBytes += audioBuffer.length;
            if (audioChunkCount <= 3) {
              console.log(`[ElevenLabs] Audio chunk #${audioChunkCount}: ${audioBuffer.length} bytes`);
            }
            this.emit("audio_chunk", audioBuffer);
          }

          if (msg.isFinal) {
            console.log("[ElevenLabs] Received isFinal flag");
            finish();
          }
        } catch (e) {
          // Not JSON — might be raw binary audio
          if (Buffer.isBuffer(data) && data.length > 0) {
            audioChunkCount++;
            totalAudioBytes += data.length;
            console.log(`[ElevenLabs] Raw binary chunk #${audioChunkCount}: ${data.length} bytes`);
            this.emit("audio_chunk", data);
          } else {
            console.error(`[ElevenLabs] Unparseable message: ${(e as Error).message}`);
          }
        }
      });

      sock.on("error", (err: Error) => {
        console.error("[ElevenLabs] WebSocket error:", err.message);
        this.emit("error", err);
        finish();
      });

      sock.on("close", (code: number, reason: Buffer) => {
        console.log(`[ElevenLabs] WebSocket closed — code: ${code}, reason: ${reason?.toString() || "none"}`);
        finish();
      });
    });
  }

  private cleanup() {
    if (this.ws) {
      try {
        if (this.ws.readyState === 1 /* OPEN */) {
          this.ws.close();
        }
      } catch (e) { /* ignore */ }
      this.ws = null;
    }
  }
}
