import { EventEmitter } from "events";
import type { LiveClient } from "@deepgram/sdk";
import { createClient, LiveTranscriptionEvents } from "@deepgram/sdk";

const DEEPGRAM_API_KEY = process.env.DEEPGRAM_API_KEY;

export class DeepgramSTTStreamer extends EventEmitter {
  private connection: LiveClient | null = null;

  constructor() {
    super();
  }

  public async start() {
    if (!DEEPGRAM_API_KEY) {
      throw new Error("DEEPGRAM_API_KEY is missing");
    }
    const deepgram = createClient(DEEPGRAM_API_KEY);

    // Establish connection and wait for open or error
    this.connection = await deepgram.listen.live({
      model: "nova-2-general",
      interim_results: true,
      punctuate: true,
      encoding: "linear16",
      sample_rate: 48000,
      channels: 1, // mono input
      vad_events: true,
      utterance_end_ms: 700,
    });

    const opened = new Promise<void>((resolve, reject) => {
      this.connection!.on(LiveTranscriptionEvents.Open, () => resolve());
      this.connection!.on(LiveTranscriptionEvents.Error, (e: any) => reject(e));
      // Some versions may emit generic 'error'
      (this.connection as any).on?.("error", (e: any) => reject(e));
    });
    await opened; // If this rejects, caller's await will reject

    // Runtime events (listeners already attached by server before start)
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
          console.log(`[STT] ${isFinal ? "FINAL" : "interim"}:`, transcript);
          this.emit("transcript", transcript, isFinal);
        }
      } catch (err) {
        this.emit("error", err);
      }
    });

    this.connection.on(LiveTranscriptionEvents.Close, () => {
      console.warn("[STT] Deepgram socket closed");
    });
    this.connection.on(LiveTranscriptionEvents.Error, (e: any) => {
      console.error("[STT] Deepgram socket error:", e);
      this.emit("error", e);
    });
  }

  public write(chunk: Buffer | ArrayBuffer) {
    try {
      if (!this.connection) {
        console.warn("[STT] write() called before Deepgram connection open");
        return;
      }
      const buf = chunk instanceof Buffer ? chunk : Buffer.from(chunk as ArrayBuffer);
      // Deepgram Node SDK accepts Node Buffers at runtime; cast to appease TS types
      (this.connection as any).send(buf);
    } catch (err) {
      console.error("[STT] write() failed:", err);
      this.emit("error", err as Error);
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
