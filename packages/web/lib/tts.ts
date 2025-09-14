export async function synthesizeSpeech(text: string): Promise<string> {
  const provider = (process.env.TTS_PROVIDER || 'azure').toLowerCase();
  if (provider === 'elevenlabs') {
    return synthesizeElevenLabs(text);
  }
  const KEY = process.env.AZURE_SPEECH_KEY || '';
  const REGION = process.env.AZURE_SPEECH_REGION || '';
  const VOICE = process.env.AZURE_TTS_VOICE || 'en-US-AshleyNeural';
  const RATE = process.env.AZURE_TTS_RATE || '+25%';
  const PITCH = process.env.AZURE_TTS_PITCH || '+25%';

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
    method: 'POST',
    headers: {
      'Ocp-Apim-Subscription-Key': KEY,
      // Switch to WebM Opus output
      'X-Microsoft-OutputFormat': 'webm-24khz-16bit-mono-opus',
      'Content-Type': 'application/ssml+xml',
      'User-Agent': 'kira-mvp',
      'Cache-Control': 'no-cache',
      Pragma: 'no-cache',
      Accept: '*/*',
    },
    body: ssml,
  });

  if (!r.ok) {
    const body = await r.text();
    throw new Error(`Azure TTS failed: ${r.status} ${body}`);
  }

  const buf = Buffer.from(await r.arrayBuffer());
  return buf.toString('base64');
}

// Stream Azure TTS WebM Opus audio chunks via callback for low-latency playback
export async function synthesizeSpeechStream(
  text: string,
  onChunk: (chunk: Uint8Array) => void | Promise<void>,
): Promise<void> {
  const provider = (process.env.TTS_PROVIDER || 'azure').toLowerCase();
  if (provider === 'elevenlabs') {
    await synthesizeElevenLabsStream(text, onChunk);
    return;
  }
  const KEY = process.env.AZURE_SPEECH_KEY || '';
  const REGION = process.env.AZURE_SPEECH_REGION || '';
  const VOICE = process.env.AZURE_TTS_VOICE || 'en-US-AshleyNeural';
  const RATE = process.env.AZURE_TTS_RATE || '+25%';
  const PITCH = process.env.AZURE_TTS_PITCH || '+25%';

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
    method: 'POST',
    headers: {
      'Ocp-Apim-Subscription-Key': KEY,
      'X-Microsoft-OutputFormat': 'webm-24khz-16bit-mono-opus',
      'Content-Type': 'application/ssml+xml',
      'User-Agent': 'kira-mvp',
      'Cache-Control': 'no-cache',
      Pragma: 'no-cache',
      Accept: '*/*',
    },
    body: ssml,
  });

  if (!r.ok) {
    const body = await r.text();
    throw new Error(`Azure TTS failed: ${r.status} ${body}`);
  }

  const body = r.body;
  if (!body) {
    // No stream; fallback to non-streaming
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
    try {
      reader.releaseLock();
    } catch {}
  }
}

function escapeXml(s: string) {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

// --- ElevenLabs fallback ---
async function synthesizeElevenLabs(text: string): Promise<string> {
  const key = process.env.ELEVENLABS_API_KEY || '';
  const voice = process.env.ELEVENLABS_VOICE_ID || '21m00Tcm4TlvDq8ikWAM';
  if (!key) throw new Error('Missing ELEVENLABS_API_KEY');
  const r = await fetch(`https://api.elevenlabs.io/v1/text-to-speech/${voice}`, {
    method: 'POST',
    headers: {
      'xi-api-key': key,
      'Content-Type': 'application/json',
      Accept: 'audio/mpeg',
    },
    body: JSON.stringify({
      text,
      model_id: process.env.ELEVENLABS_MODEL || 'eleven_monolingual_v1',
    }),
  });
  if (!r.ok) {
    const body = await r.text();
    throw new Error(`ElevenLabs TTS failed: ${r.status} ${body}`);
  }
  const buf = Buffer.from(await r.arrayBuffer());
  return buf.toString('base64');
}

async function synthesizeElevenLabsStream(
  text: string,
  onChunk: (chunk: Uint8Array) => void | Promise<void>,
) {
  // ElevenLabs streaming API (simplified) - if not available, fallback to non-stream
  try {
    const b64 = await synthesizeElevenLabs(text);
    await onChunk(Uint8Array.from(Buffer.from(b64, 'base64')));
  } catch (e) {
    throw e;
  }
}
