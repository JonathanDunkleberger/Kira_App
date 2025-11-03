// packages/socket-server/google-stt-streamer.ts

import { SpeechClient } from "@google-cloud/speech";
import { EventEmitter } from "events";

// Initialize the Google Speech Client
// Requires GOOGLE_APPLICATION_CREDENTIALS env var (JSON service account) or ADC in environment.
const speechClient = new SpeechClient();

// Configuration matching browser MediaRecorder (audio/webm;codecs=opus)
// Google supports WEBM_OPUS for streamingRecognize.
const DEFAULT_STT_CONFIG = {
  encoding: "WEBM_OPUS" as const,
  // Opus uses a 48kHz sampling rate internally
  sampleRateHertz: 48000,
  languageCode: "en-US",
  // Improve punctuation for better downstream LLM quality
  enableAutomaticPunctuation: true,
};

export class GoogleSTTStreamer extends EventEmitter {
  private recognizeStream: ReturnType<
    SpeechClient["streamingRecognize"]
  > | null = null;
  private fullTranscript: string = "";
  private configSent = false;
  private effectiveConfig: Record<string, any>;
  private audioQueue: Buffer[] = [];

  constructor(configOverride?: Record<string, any>) {
    super();
    this.fullTranscript = "";
    this.effectiveConfig = { ...DEFAULT_STT_CONFIG, ...(configOverride || {}) };

    // Create a new bi-directional stream (we'll send config as the FIRST message explicitly)
    this.recognizeStream = speechClient
      .streamingRecognize()
      .on("error", (error: any) => {
        console.error("[G-STT] Stream Error:", error);
        this.configSent = false; // Reset state on error
        this.emit("error", error);
      })
      .on("data", (data: any) => {
        const result = data?.results?.[0];
        const transcript = result?.alternatives?.[0]?.transcript || "";

        if (result?.isFinal) {
          if (transcript) {
            console.log(`[G-STT] ✅ Final Transcript Segment: "${transcript}"`);
            this.fullTranscript += transcript + " ";
            this.emit("final_transcript_segment", transcript);
          }
          // If Google's VAD believes the utterance ended, emit utterance_end with the aggregated transcript
          const aggregated = this.fullTranscript.trim();
          if (aggregated.length > 0) {
            this.emit("utterance_end", aggregated);
            // Reset buffer for the next utterance to avoid re-sending previous text
            this.fullTranscript = "";
          }
        } else if (transcript) {
          console.log(`[G-STT] Interim: ${transcript}`);
          this.emit("interim_transcript", transcript);
        }
      })
      .on("end", () => {
        console.log("[G-STT] Stream ended gracefully.");
        this.emit("close");
      });

    console.log("[G-STT] New Google STT Stream initialized.");

    // Immediately send the streaming configuration as the first message
    try {
      (this.recognizeStream as any).write({
        streamingConfig: {
          config: this.effectiveConfig,
          interimResults: true,
        },
      });
      this.configSent = true;
      console.log("[G-STT] ✅ Configuration sent to stream.");
      // Notify listeners that the stream is ready to receive audio
      this.emit("ready");
      // Flush any buffered audio into the stream now that it's ready
      try {
        while (this.audioQueue.length > 0) {
          const chunk = this.audioQueue.shift()!;
          (this.recognizeStream as any).write({ audioContent: chunk });
        }
      } catch (flushErr) {
        console.error('[G-STT] Error while flushing buffered audio:', flushErr);
      }
    } catch (e) {
      console.error("[G-STT] Failed to send initial streaming config:", e);
    }
  }

  // Pipe client audio chunks into the Google STT stream
  public write(audioChunk: Buffer) {
    if (!this.recognizeStream || !(this.recognizeStream as any).writable) return;
    if (!this.configSent) {
      // Buffer the audio until the stream is ready
      this.audioQueue.push(audioChunk);
      console.log(`[G-STT] Buffered chunk, queue size: ${this.audioQueue.length}`);
      return;
    }
    (this.recognizeStream as any).write({ audioContent: audioChunk });
  }
  public getConfig(): Record<string, any> {
    return { ...this.effectiveConfig };
  }

  // Signal the end of user's audio (from client EOU)
  public end() {
    if (this.recognizeStream && (this.recognizeStream as any).writable) {
      console.log(
        "[G-STT] Received client EOU. Ending stream to force final result."
      );
      (this.recognizeStream as any).end();
    }
  }

  // Cleanly close and reset stream state
  public closeStream() {
    try {
      if (this.recognizeStream && (this.recognizeStream as any).writable) {
        (this.recognizeStream as any).end();
      }
    } catch {}
    this.recognizeStream = null;
    this.configSent = false;
  }

  // Retrieve the full transcript collected so far
  public getFullTranscript(): string {
    return this.fullTranscript.trim();
  }

  // Expose readiness for audio writes
  public isReady(): boolean {
    return this.configSent && !!this.recognizeStream;
  }

  // Aliases for semantic clarity with server usage
  public writeAudio(buf: Buffer) {
    this.write(buf);
  }
  public endAudioStream() {
    this.end();
  }
}
