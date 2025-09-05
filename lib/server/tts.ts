export async function synthesizeSpeech(text: string, format: 'webm' | 'mp3' = 'webm'): Promise<string> {
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
  // Choose output format based on client preference
  const outFmt = format === 'mp3' ? 'audio-24khz-48kbitrate-mono-mp3' : 'webm-24khz-16bit-mono-opus';
  const r = await fetch(url, {
    method: "POST",
    headers: {
      "Ocp-Apim-Subscription-Key": KEY,
      "X-Microsoft-OutputFormat": outFmt,
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

export async function synthesizeSpeechStream(
  text: string,
  onChunk: (chunk: Uint8Array) => void | Promise<void>,
  format: 'webm' | 'mp3' = 'webm'
): Promise<void> {
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
  const outFmt = format === 'mp3' ? 'audio-24khz-48kbitrate-mono-mp3' : 'webm-24khz-16bit-mono-opus';
  const r = await fetch(url, {
    method: "POST",
    headers: {
      "Ocp-Apim-Subscription-Key": KEY,
      "X-Microsoft-OutputFormat": outFmt,
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

  const body = r.body;
  if (!body) {
    const buf = Buffer.from(await r.arrayBuffer());
    await onChunk(new Uint8Array(buf));
    return;
  }

  const reader = body.getReader();
  try {
    while (true) {
      const { value, done } = await reader.read();
      if (done) break;
      if (value && value.byteLength) {
        await onChunk(value);
      }
    }
  } finally {
    try { reader.releaseLock(); } catch {}
  }
}

function escapeXml(s: string) {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
}
