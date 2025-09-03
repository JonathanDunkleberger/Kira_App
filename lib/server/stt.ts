export async function transcribeWebmToText(bytes: Uint8Array): Promise<string> {
  const apiKey = process.env.OPENAI_API_KEY || '';
  if (!apiKey) {
    throw new Error('OPENAI_API_KEY missing for STT');
  }
  const { default: OpenAI } = await import('openai');
  const openai = new OpenAI({ apiKey });
  const ab = new ArrayBuffer(bytes.byteLength);
  new Uint8Array(ab).set(bytes);
  const FileCtor: any = (globalThis as any).File;
  const file: any = new FileCtor([ab], 'audio.webm', { type: 'audio/webm' });
  const result = await openai.audio.transcriptions.create({
    file,
    model: 'whisper-1'
  } as any);
  // @ts-ignore
  return (result.text as string)?.trim() || '';
}
