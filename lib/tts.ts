import { env } from './env';
import fetch from 'node-fetch';

export async function ttsToMp3Base64(text: string): Promise<{ b64: string; charCount: number; estSeconds: number }> {
  const ssml = `
<speak version="1.0" xml:lang="en-US">
  <voice name="${env.AZURE_TTS_VOICE}">
    <prosody rate="${env.AZURE_TTS_RATE}" pitch="${env.AZURE_TTS_PITCH}">
      ${escapeXml(text)}
    </prosody>
  </voice>
</speak>`.trim();

  const endpoint = `https://${env.AZURE_SPEECH_REGION}.tts.speech.microsoft.com/cognitiveservices/v1`;
  const res = await fetch(endpoint, {
    method: 'POST',
    headers: {
      'Ocp-Apim-Subscription-Key': env.AZURE_SPEECH_KEY,
      'Content-Type': 'application/ssml+xml',
      'X-Microsoft-OutputFormat': 'audio-24khz-48kbitrate-mono-mp3',
      'User-Agent': 'kira-mvp'
    },
    body: ssml
  });

  if (!res.ok) {
    const textErr = await res.text();
    throw new Error(`Azure TTS failed: ${res.status} ${textErr}`);
  }

  const buf = Buffer.from(await res.arrayBuffer());
  const b64 = buf.toString('base64');
  const charCount = text.length;
  const estSeconds = Math.max(1, Math.round(charCount / 14)); // conservative
  return { b64, charCount, estSeconds };
}

function escapeXml(s: string) {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g,'&gt;');
}
