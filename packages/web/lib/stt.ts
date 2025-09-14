// Transcribe WebM bytes using OpenAI Whisper via REST (no SDK)
export async function transcribeWebmToText(bytes: Uint8Array): Promise<string> {
  const apiKey = process.env.OPENAI_API_KEY || '';
  if (!apiKey) throw new Error('OPENAI_API_KEY missing for STT');

  // Build a Blob from the provided bytes and submit using multipart/form-data
  const ab = new ArrayBuffer(bytes.byteLength);
  new Uint8Array(ab).set(bytes);
  const blob = new Blob([ab], { type: 'audio/webm' });

  const form = new FormData();
  // Provide a filename when appending a Blob to ensure proper multipart handling
  form.append('file', blob, 'audio.webm');
  form.append('model', 'whisper-1');
  form.append('language', 'en');
  form.append('temperature', '0');

  const r = await fetch('https://api.openai.com/v1/audio/transcriptions', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${apiKey}`,
    },
    body: form as any,
  });

  if (!r.ok) {
    const body = await r.text().catch(() => '');
    throw new Error(`Whisper transcription failed: ${r.status} ${body}`);
  }
  const data = (await r.json()) as { text?: string };
  return (data.text || '').trim();
}
