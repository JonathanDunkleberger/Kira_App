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

export interface AzureVoiceConfig {
  voiceName: string;
  style?: string;
  rate?: string;
  pitch?: string;
}

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

function escapeXml(text: string): string {
  return text
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&apos;");
}

export class AzureTTSStreamer extends EventEmitter {
  private synthesizer: SpeechSynthesizer;
  private audioStream: PassThrough;
  private voiceConfig: AzureVoiceConfig;

  constructor(config?: AzureVoiceConfig) {
    super();
    this.voiceConfig = config || {
      voiceName: process.env.AZURE_TTS_VOICE || "en-US-AshleyNeural",
      rate: process.env.AZURE_TTS_RATE || "+25.00%",
      pitch: process.env.AZURE_TTS_PITCH || "+25.00%",
    };

    const speechConfig = SpeechConfig.fromSubscription(
      AZURE_SPEECH_KEY,
      AZURE_SPEECH_REGION
    );
    speechConfig.speechSynthesisOutputFormat =
      SpeechSynthesisOutputFormat.Raw16Khz16BitMonoPcm;

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
      this.synthesizer.close();
      this.audioStream.destroy();
      console.log("[AzureTTS] Stopped synthesis.");
    } catch (e) {
      console.error("[AzureTTS] Error stopping synthesizer:", e);
    }
  }

  private buildSsml(text: string): string {
    const escaped = escapeXml(text);
    const { voiceName, style, rate, pitch } = this.voiceConfig;

    // Build from inside out: text → prosody → express-as
    let innerContent = escaped;

    // If rate/pitch are set, wrap in prosody (innermost)
    if (rate || pitch) {
      const rateAttr = rate ? ` rate="${rate}"` : "";
      const pitchAttr = pitch ? ` pitch="${pitch}"` : "";
      innerContent = `<prosody${rateAttr}${pitchAttr}>${innerContent}</prosody>`;
    }

    // If a speaking style is requested, wrap in express-as (outermost)
    if (style) {
      innerContent = `<mstts:express-as style="${style}">${innerContent}</mstts:express-as>`;
    }

    return `<speak version="1.0" xmlns="http://www.w3.org/2001/10/synthesis" xmlns:mstts="https://www.w3.org/2001/mstts" xml:lang="en-US"><voice name="${voiceName}">${innerContent}</voice></speak>`;
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
