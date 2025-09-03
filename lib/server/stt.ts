export async function transcribeWebmToText(bytes: Uint8Array): Promise<string> {
  const apiKey = process.env.OPENAI_API_KEY || '';
  if (!apiKey) throw new Error('OPENAI_API_KEY missing for STT');

  // Node 18+: use global fetch/FormData/Blob
  const form = new FormData();
  const ab = new ArrayBuffer(bytes.byteLength);
  new Uint8Array(ab).set(bytes);
  const blob = new Blob([ab as ArrayBuffer], { type: 'audio/webm' });
  form.append('file', blob, 'audio.webm');
  form.append('model', 'whisper-1');

  const r = await fetch('https://api.openai.com/v1/audio/transcriptions', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${apiKey}`,
    },
    body: form,
  });
  if (!r.ok) {
    const body = await r.text().catch(() => '');
    throw new Error(`OpenAI STT failed: ${r.status} ${body}`);
  }
  const json: any = await r.json();
  return (json.text as string)?.trim() || '';
}
