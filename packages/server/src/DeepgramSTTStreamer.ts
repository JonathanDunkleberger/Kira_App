import { EventEmitter } from "events";
import type { LiveClient } from "@deepgram/sdk";
import { createClient, LiveTranscriptionEvents } from "@deepgram/sdk";

const DEEPGRAM_API_KEY = process.env.DEEPGRAM_API_KEY!;

export class DeepgramSTTStreamer extends EventEmitter {
  private connection: LiveClient | null = null;

  constructor() {
    super();
  }

  public async start() {
    try {
      const deepgram = createClient(DEEPGRAM_API_KEY);
      this.connection = await deepgram.listen.live({
        model: "nova-2",
        interim_results: true,
        punctuate: true,
        encoding: "linear16",
        sample_rate: 16000,
      });

      this.connection.on(LiveTranscriptionEvents.Open, () => {
        // Ready to receive audio
      });

      this.connection.on(
        LiveTranscriptionEvents.Transcript,
        (data: any) => {
          try {
            const channel = data.channel || data.channel_index || data.data?.channel;
            const alt = (data.channel?.alternatives?.[0]) || (data.alternatives?.[0]) || channel?.alternatives?.[0];
            const transcript: string | undefined = alt?.transcript;
            const isFinal: boolean = Boolean(data.is_final ?? data.speech_final ?? alt?.is_final);
            if (transcript && transcript.trim().length > 0) {
              this.emit("transcript", transcript, isFinal);
            }
          } catch (err) {
            this.emit("error", err);
          }
        }
      );

      this.connection.on(LiveTranscriptionEvents.Error, (e: any) => {
        this.emit("error", e);
      });

      this.connection.on(LiveTranscriptionEvents.Close, () => {
        // closed
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
      this.connection?.finalize?.();
      this.connection?.finish?.();
    } catch (err) {
      // ignore
    }
  }

  public destroy() {
    try {
      this.connection?.finalize?.();
      this.connection?.finish?.();
    } catch (err) {
      // ignore
    } finally {
      this.connection = null;
    }
  }
}
