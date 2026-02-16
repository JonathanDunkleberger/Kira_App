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
  temperature?: string;   // "0.0" to "1.0" — higher = more expressive
  topP?: string;           // should match temperature for best results
  emotion?: string;        // current emotion for prosody adjustment (from [EMO:...] tag)
}

// Prosody adjustments per emotion — applied ON TOP of the base voice config
// rate: percentage change ("+10%" = 10% faster, "-15%" = 15% slower)
// pitch: percentage or semitone change
// volume: "soft", "medium", "loud", or percentage like "+10%"
interface EmotionProsody {
  rate?: string;
  pitch?: string;
  volume?: string;
}

const EMOTION_PROSODY: Record<string, EmotionProsody> = {
  neutral:     {},
  happy:       { rate: "+3%",  pitch: "+3%"  },                // subtle uplift
  excited:     { rate: "+8%",  pitch: "+5%",  volume: "+5%" }, // noticeable but not insane
  love:        { rate: "-8%",  pitch: "-3%",  volume: "soft" },// slow, warm, intimate
  blush:       { rate: "-5%",  pitch: "+5%",  volume: "soft" },// shy, slightly higher
  sad:         { rate: "-12%", pitch: "-6%",  volume: "soft" },// slow, lower, quiet
  angry:       { rate: "+5%",  pitch: "-3%",  volume: "+10%" },// tight, lower, louder
  playful:     { rate: "+5%",  pitch: "+5%"  },                // bouncy, bright
  thinking:    { rate: "-8%",  pitch: "-2%"  },                // slower, deliberate
  speechless:  { rate: "-15%", pitch: "-5%"  },                // very slow, flat
  eyeroll:     { rate: "+3%",  pitch: "-2%"  },                // slightly faster, flat/bored
  sleepy:      { rate: "-15%", pitch: "-8%",  volume: "soft" },// very slow, low, quiet
  frustrated:  { rate: "+3%",  pitch: "-3%",  volume: "+5%" }, // slightly tight, harder
  confused:    { rate: "-5%",  pitch: "+3%"  },                // slower, rising inflection
  surprised:   { rate: "+5%",  pitch: "+8%",  volume: "+5%" }, // fast, high, loud
};

/**
 * Merge a base prosody value (e.g. "+25%") with an emotion adjustment (e.g. "+10%").
 * Both are percentage strings — they get added together: +25% + +10% = +35%.
 */
function mergeRateOrPitch(base: string | undefined, emotionAdj: string | undefined): string | undefined {
  if (!emotionAdj) return base;
  if (!base) return emotionAdj;

  const baseMatch = base.match(/^([+-]?\d+(?:\.\d+)?)%$/);
  const emotionMatch = emotionAdj.match(/^([+-]?\d+(?:\.\d+)?)%$/);

  if (baseMatch && emotionMatch) {
    const total = parseFloat(baseMatch[1]) + parseFloat(emotionMatch[1]);
    return `${total >= 0 ? "+" : ""}${total.toFixed(0)}%`;
  }

  // If formats don't match, prefer emotion adjustment
  return emotionAdj;
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
    const { voiceName, style, rate, pitch, temperature, topP, emotion } = this.voiceConfig;

    // Get emotion-based prosody adjustments
    const emotionProsody = EMOTION_PROSODY[emotion || "neutral"] || {};

    // Merge base rate/pitch with emotion adjustments (additive)
    const finalRate = mergeRateOrPitch(rate, emotionProsody.rate);
    const finalPitch = mergeRateOrPitch(pitch, emotionProsody.pitch);
    const finalVolume = emotionProsody.volume; // volume doesn't stack with base

    // Build from inside out: text → prosody → express-as
    let innerContent = escaped;

    // If rate/pitch/volume are set, wrap in prosody (skip for DragonHD voices — they handle it contextually)
    if (finalRate || finalPitch || finalVolume) {
      const rateAttr = finalRate ? ` rate="${finalRate}"` : "";
      const pitchAttr = finalPitch ? ` pitch="${finalPitch}"` : "";
      const volumeAttr = finalVolume ? ` volume="${finalVolume}"` : "";
      innerContent = `<prosody${rateAttr}${pitchAttr}${volumeAttr}>${innerContent}</prosody>`;
    }

    // If a speaking style is requested, wrap in express-as
    if (style) {
      innerContent = `<mstts:express-as style="${style}">${innerContent}</mstts:express-as>`;
    }

    // Build parameters string for DragonHD Omni voices (temperature, top_p)
    const params: string[] = [];
    if (temperature) params.push(`temperature=${temperature}`);
    if (topP) params.push(`top_p=${topP}`);
    const paramsAttr = params.length > 0 ? ` parameters="${params.join(";")}"` : "";

    return `<speak version="1.0" xmlns="http://www.w3.org/2001/10/synthesis" xmlns:mstts="https://www.w3.org/2001/mstts" xml:lang="en-US"><voice name="${voiceName}"${paramsAttr}>${innerContent}</voice></speak>`;
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
