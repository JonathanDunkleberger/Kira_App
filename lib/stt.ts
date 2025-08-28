export async function transcribeWebmToText(bytes: Uint8Array): Promise<string> {
  const apiKey = process.env.OPENAI_API_KEY || '';
  if (!apiKey) {
    throw new Error('OPENAI_API_KEY missing for STT');
  }
  // Lazy load OpenAI implementation
  const { default: OpenAI } = await import('openai');
  const openai = new OpenAI({ apiKey });
  // Use native File in modern Node runtimes; ensure BlobPart typing compatibility by copying into a fresh ArrayBuffer
  const ab = new ArrayBuffer(bytes.byteLength);
  new Uint8Array(ab).set(bytes);
  const file: any = new File([ab], 'audio.webm', { type: 'audio/webm' });
  const result = await openai.audio.transcriptions.create({
    file,
    model: 'whisper-1'
  } as any);
  // @ts-ignore
  return (result.text as string)?.trim() || '';
}
