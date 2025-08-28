import crypto from "crypto";

export async function synthesizeSpeech(text: string): Promise<string> {
  const KEY = process.env.AZURE_SPEECH_KEY || '';
  const REGION = process.env.AZURE_SPEECH_REGION || '';
  const VOICE = process.env.AZURE_TTS_VOICE || "en-US-AshleyNeural";
  const RATE = process.env.AZURE_TTS_RATE || "+25%";
  const PITCH = process.env.AZURE_TTS_PITCH || "+25%";

  if (!KEY || !REGION) {
    throw new Error('Missing AZURE_SPEECH_KEY or AZURE_SPEECH_REGION');
  }
  const ssml = `
  <speak version="1.0" xml:lang="en-US">
    <voice name="${VOICE}">
      <prosody rate="${RATE}" pitch="${PITCH}">${escapeXml(text)}</prosody>
    </voice>
  </speak>`.trim();

  const url = `https://${REGION}.tts.speech.microsoft.com/cognitiveservices/v1`;
  const r = await fetch(url, {
    method: "POST",
    headers: {
      "Ocp-Apim-Subscription-Key": KEY,
      "X-Microsoft-OutputFormat": "audio-24khz-48kbitrate-mono-mp3",
      "Content-Type": "application/ssml+xml",
      "User-Agent": "kira-mvp",
      "Cache-Control": "no-cache",
      "Pragma": "no-cache",
      "Accept": "*/*"
    },
    body: ssml,
  });

  if (!r.ok) {
    const body = await r.text();
    throw new Error(`Azure TTS failed: ${r.status} ${body}`);
  }

  const buf = Buffer.from(await r.arrayBuffer());
  return buf.toString("base64");
}

function escapeXml(s: string) {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
}
