import { SpeechClient, protos } from "@google-cloud/speech";
import { EventEmitter } from "events";

const STREAMING_CONFIG: protos.google.cloud.speech.v1.IStreamingRecognizeRequest =
  {
    streamingConfig: {
      config: {
        encoding:
          protos.google.cloud.speech.v1.RecognitionConfig.AudioEncoding
            .LINEAR16,
        sampleRateHertz: 16000,
        languageCode: "en-US",
        enableAutomaticPunctuation: true,
      },
      interimResults: true,
    },
  };

export class GoogleSTTStreamer extends EventEmitter {
  private readonly speechClient: SpeechClient;
  private stream: ReturnType<SpeechClient["streamingRecognize"]> | null = null;

  constructor() {
    super();
    this.speechClient = new SpeechClient();
  }

  public start() {
    this.stream = this.speechClient
      .streamingRecognize()
      .on("error", (err) => {
        console.error("[G-STT] Stream Error:", err.message);
        this.emit("error", err);
      })
      .on("data", (data) => {
        const transcript = data.results?.[0]?.alternatives?.[0]?.transcript;
        if (!transcript) return;

        if (data.results?.[0]?.isFinal) {
          this.emit("transcript", transcript, true);
        } else {
          this.emit("transcript", transcript, false);
        }
      });
    this.stream.write(STREAMING_CONFIG);
    console.log("[G-STT] ✅ Stream created and config sent.");
  }

  public write(audioChunk: Buffer) {
    if (!this.stream) return;

    try {
      this.stream.write({ audioContent: audioChunk });
    } catch (err) {
      console.error(
        "[G-STT] Error writing audio to stream:",
        (err as Error).message
      );
    }
  }

  public finalize() {
    this.stream?.end();
  }

  public destroy() {
    if (this.stream) {
      this.stream.removeAllListeners();
      this.stream.end();
      this.stream = null;
    }
    this.speechClient.close().catch(console.error);
  }
}
