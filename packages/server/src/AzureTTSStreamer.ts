import {
  SpeechSynthesizer,
  SpeechConfig,
  AudioConfig,
  ResultReason,
  CancellationDetails,
  SpeechSynthesisOutputFormat,
  PushAudioOutputStreamCallback,
  PushAudioOutputStream,
} from "microsoft-cognitiveservices-speech-sdk";
import { EventEmitter } from "events";
import { PassThrough } from "stream";

const AZURE_SPEECH_KEY = process.env.AZURE_SPEECH_KEY!;
const AZURE_SPEECH_REGION = process.env.AZURE_SPEECH_REGION!;
const AZURE_TTS_VOICE = process.env.AZURE_TTS_VOICE || "en-US-AshleyNeural";
const AZURE_TTS_RATE = process.env.AZURE_TTS_RATE || "+25.00%";
const AZURE_TTS_PITCH = process.env.AZURE_TTS_PITCH || "+25.00%";

const speechConfig = SpeechConfig.fromSubscription(
  AZURE_SPEECH_KEY,
  AZURE_SPEECH_REGION
);
// We request raw 16kHz PCM to feed directly to the LINEAR16 WebSocket pipeline.
speechConfig.speechSynthesisOutputFormat =
  SpeechSynthesisOutputFormat.Raw16Khz16BitMonoPcm;

class NodePushAudioStream extends PushAudioOutputStreamCallback {
  constructor(private readonly stream: PassThrough) {
    super();
  }

  write(data: ArrayBuffer): number {
    const buffer = Buffer.from(data);
    this.stream.write(buffer);
    return buffer.length;
  }

  close(): void {
    this.stream.end();
  }
}

export class AzureTTSStreamer extends EventEmitter {
  private synthesizer: SpeechSynthesizer;
  private audioStream: PassThrough;

  constructor() {
    super();
    this.audioStream = new PassThrough();
    const pushStream = PushAudioOutputStream.create(
      new NodePushAudioStream(this.audioStream)
    );
    const audioConfig = AudioConfig.fromStreamOutput(pushStream);
    this.synthesizer = new SpeechSynthesizer(speechConfig, audioConfig);

    this.audioStream.on("data", (chunk) => this.emit("audio_chunk", chunk));
    this.audioStream.on("end", () => this.emit("tts_complete"));
  }

  public stop() {
    try {
      // Close the synthesizer to stop generation
      this.synthesizer.close();
      // Destroy the stream to stop emitting data events
      this.audioStream.destroy();
      console.log("[AzureTTS] Stopped synthesis.");
    } catch (e) {
      console.error("[AzureTTS] Error stopping synthesizer:", e);
    }
  }

  private escapeXml(text: string): string {
    return text
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;');
  }

  private buildSsml(text: string): string {
    return `
      <speak version="1.0" xmlns="http://www.w3.org/2001/10/synthesis" xmlns:mstts="http://www.w3.org/2001/10/synthesis" xml:lang="en-US">
        <voice name="${AZURE_TTS_VOICE}">
          <prosody rate="${AZURE_TTS_RATE}" pitch="${AZURE_TTS_PITCH}">
            ${this.escapeXml(text)}
          </prosody>
        </voice>
      </speak>
    `;
  }

  public synthesize(text: string) {
    const ssml = this.buildSsml(text);
    this.synthesizer.speakSsmlAsync(
      ssml,
      (result) => {
        if (result.reason !== ResultReason.SynthesizingAudioCompleted) {
          const errorDetails = CancellationDetails.fromResult(result);
          console.error(
            "[AzureTTS] ❌ Synthesis canceled:",
            errorDetails.reason,
            errorDetails.errorDetails
          );
          this.emit("error", errorDetails.errorDetails);
        }
        this.synthesizer.close();
      },
      (err) => {
        console.error("[AzureTTS] ❌ Synthesis error:", err);
        this.emit("error", err);
        this.synthesizer.close();
      }
    );
  }
}
