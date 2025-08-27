import OpenAI from 'openai';

export async function transcribeWebmToText(webm: Buffer): Promise<string> {
  const apiKey = process.env.OPENAI_API_KEY || '';
  if (!apiKey) {
    throw new Error('OPENAI_API_KEY missing for STT');
  }
  const openai = new OpenAI({ apiKey });
  // OpenAI expects a File-like object; create via Blob in Node 18
  const blob = new Blob([webm], { type: 'audio/webm' });
  const file: any = new File([blob], 'audio.webm', { type: 'audio/webm' } as any);
  const result = await openai.audio.transcriptions.create({
    file,
    model: 'whisper-1'
  } as any);
  // @ts-ignore
  return (result.text as string)?.trim() || '';
}
