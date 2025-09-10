import * as sdk from 'microsoft-cognitiveservices-speech-sdk';
export async function warmAzureTtsConnection(): Promise<void> {
  const KEY = process.env.AZURE_SPEECH_KEY || '';
  const REGION = process.env.AZURE_SPEECH_REGION || '';
  if (!KEY || !REGION) return;
  try {
    const url = `https://${REGION}.tts.speech.microsoft.com/cognitiveservices/voices/list`;
    await fetch(url, {
      method: 'GET',
      headers: {
        'Ocp-Apim-Subscription-Key': KEY,
        Accept: 'application/json',
        'User-Agent': 'kira-mvp',
      },
    }).then((r) => {
      try {
        void r.arrayBuffer();
      } catch {}
    });
  } catch (e) {
    // Non-fatal: warming is best-effort
    try {
      console.warn('[TTS] Warm-up failed:', e);
    } catch {}
  }
}

// --- Azure TTS settings live here ---
// Hard-coded voice and prosody per requirements.
const VOICE_NAME = 'en-US-AshleyNeural';
const RATE = '+25.00%';
const PITCH = '+25.00%';

function createSSML(text: string): string {
  return `
    <speak version="1.0" xmlns="http://www.w3.org/2001/10/synthesis" xml:lang="en-US">
      <voice name="${VOICE_NAME}">
        <prosody rate="${RATE}" pitch="${PITCH}">
          ${escapeXml(text)}
        </prosody>
      </voice>
    </speak>
  `.trim();
}
// --- end settings block ---

function getSpeechSynthesizer(format: 'webm' | 'mp3' = 'webm') {
  const key = process.env.AZURE_SPEECH_KEY || '';
  const region = process.env.AZURE_SPEECH_REGION || '';
  if (!key || !region) throw new Error('Missing AZURE_SPEECH_KEY or AZURE_SPEECH_REGION');

  const speechConfig = sdk.SpeechConfig.fromSubscription(key, region);
  speechConfig.speechSynthesisVoiceName = VOICE_NAME;
  speechConfig.speechSynthesisOutputFormat =
    format === 'mp3'
      ? sdk.SpeechSynthesisOutputFormat.Audio24Khz48KBitRateMonoMp3
      : sdk.SpeechSynthesisOutputFormat.Webm24Khz16BitMonoOpus;
  // For server-side, omit AudioConfig to avoid using speakers
  const synthesizer = new sdk.SpeechSynthesizer(speechConfig);
  return synthesizer;
}

export async function synthesizeSpeech(
  text: string,
  format: 'webm' | 'mp3' = 'webm',
): Promise<string> {
  const ssml = createSSML(text);
  const synthesizer = getSpeechSynthesizer(format);
  try {
    const result = await new Promise((resolve, reject) => {
      synthesizer.speakSsmlAsync(
        ssml,
        (res: any) => resolve(res),
    (err: string) => reject(err),
      );
    });
    const audio = Buffer.from(new Uint8Array((result as any).audioData));
    return audio.toString('base64');
  } finally {
    synthesizer.close();
  }
}

export async function synthesizeSpeechStream(
  text: string,
  onChunk: (chunk: Uint8Array) => void | Promise<void>,
  format: 'webm' | 'mp3' = 'webm',
): Promise<void> {
  const ssml = createSSML(text);
  const key = process.env.AZURE_SPEECH_KEY || '';
  const region = process.env.AZURE_SPEECH_REGION || '';
  if (!key || !region) throw new Error('Missing AZURE_SPEECH_KEY or AZURE_SPEECH_REGION');

  const speechConfig = sdk.SpeechConfig.fromSubscription(key, region);
  speechConfig.speechSynthesisVoiceName = VOICE_NAME;
  speechConfig.speechSynthesisOutputFormat =
    format === 'mp3'
      ? sdk.SpeechSynthesisOutputFormat.Audio24Khz48KBitRateMonoMp3
      : sdk.SpeechSynthesisOutputFormat.Webm24Khz16BitMonoOpus;
  const stream = sdk.AudioOutputStream.createPullStream();
  const audioConfig = sdk.AudioConfig.fromStreamOutput(stream);
  const synthesizer = new sdk.SpeechSynthesizer(speechConfig, audioConfig);
  try {
    // Stream by reading from the pull stream in parallel with the synthesis
    const reader = (async () => {
      const CHUNK = 4096;
      for (;;) {
        const buffer = new ArrayBuffer(CHUNK);
        const view = new Uint8Array(buffer);
        const n = stream.read(view);
        if (!n || n < 0) break;
        if (n > 0) {
          await onChunk(view.slice(0, n));
        }
        // Yield to event loop
        await Promise.resolve();
      }
    })();
  await new Promise<void>((resolve, reject) => {
      synthesizer.speakSsmlAsync(
        ssml,
        () => resolve(),
    (err: string) => reject(err),
      );
    });
    await reader;
  } finally {
    synthesizer.close();
  }
}

function escapeXml(s: string) {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}
