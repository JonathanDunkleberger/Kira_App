import { EventEmitter } from "events";
import type { LiveClient } from "@deepgram/sdk";
import { createClient, LiveTranscriptionEvents } from "@deepgram/sdk";

const DEEPGRAM_API_KEY = process.env.DEEPGRAM_API_KEY!;

export class DeepgramSTTStreamer extends EventEmitter {
  private connection: LiveClient | null = null;
  private keepAliveInterval: NodeJS.Timeout | null = null;

  constructor() {
    super();
  }

  public async start() {
    try {
      const deepgram = createClient(DEEPGRAM_API_KEY);
      this.connection = await deepgram.listen.live({
        model: "nova-2",
        encoding: "linear16",
        sample_rate: 16000,
        channels: 1,
        interim_results: true,
        smart_format: true,
        endpointing: 300,
        utterance_end_ms: 1000,
        // --- [ROBUSTNESS FIX] Lenient VAD for mobile/noisy connections ---
        vad_events: true,
        // Increase silence threshold to prevent premature stream closure
        // Default is ~150ms, increased to 250ms for better mobile support
        endpointing_config: {
          silence_threshold: 250
        }
      });

      if (this.connection) {
        this.keepAliveInterval = setInterval(() => {
          if (this.connection && this.connection.getReadyState() === 1) {
            this.connection.keepAlive();
          }
        }, 3000);
      }

      this.connection.on(LiveTranscriptionEvents.Open, () => {
        console.log("[Deepgram] Connection opened.");
      });

      this.connection.on(LiveTranscriptionEvents.Transcript, (data: any) => {
        try {
          const channel =
            data.channel || data.channel_index || data.data?.channel;
          const alt =
            data.channel?.alternatives?.[0] ||
            data.alternatives?.[0] ||
            channel?.alternatives?.[0];
          const transcript: string | undefined = alt?.transcript;
          const isFinal: boolean = Boolean(
            data.is_final ?? data.speech_final ?? alt?.is_final
          );
          
          if (transcript && transcript.trim().length > 0) {
            // console.log(`[Deepgram] Transcript: "${transcript}" (Final: ${isFinal})`);
            this.emit("transcript", transcript, isFinal);
          }
        } catch (err) {
          console.error("[Deepgram] Error processing transcript:", err);
          this.emit("error", err);
        }
      });

      this.connection.on(LiveTranscriptionEvents.Error, (e: any) => {
        console.error("[Deepgram] Error:", e);
        this.emit("error", e);
      });

      this.connection.on(LiveTranscriptionEvents.Close, () => {
        console.log("[Deepgram] Connection closed.");
        this.emit("close");
      });
    } catch (err) {
      this.emit("error", err);
    }
  }

  public write(audioChunk: Buffer) {
    if (!this.connection) return;
    try {
      // Deepgram expects raw PCM LINEAR16 at 16kHz as ArrayBuffer/Blob
      const ab = audioChunk.buffer.slice(
        audioChunk.byteOffset,
        audioChunk.byteOffset + audioChunk.byteLength
      );
      this.connection.send(ab);
    } catch (err) {
      this.emit("error", err);
    }
  }

  public finalize() {
    try {
      // Send a finalize message to flush pending transcripts
      // Do NOT call finish() as that closes the connection
      if (this.connection && this.connection.getReadyState() === 1) {
        this.connection.finalize();
      }
    } catch (err) {
      // ignore
    }
  }

  public destroy() {
    try {
      if (this.keepAliveInterval) {
        clearInterval(this.keepAliveInterval);
        this.keepAliveInterval = null;
      }
      this.connection?.finalize?.();
      this.connection?.finish?.();
    } catch (err) {
      // ignore
    } finally {
      this.connection = null;
    }
  }
}
