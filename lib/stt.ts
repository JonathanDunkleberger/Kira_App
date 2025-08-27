import OpenAI from 'openai';
import { env } from './env';

const openai = new OpenAI({ apiKey: env.OPENAI_API_KEY });

export async function transcribeWebmToText(webm: Buffer): Promise<string> {
  // OpenAI expects a File object in Node >=18 via undici
  const file = new File([webm], 'audio.webm', { type: 'audio/webm' } as any);
  const result = await openai.audio.transcriptions.create({
    file,
    model: 'whisper-1'
  } as any);
  // @ts-ignore
  return (result.text as string)?.trim() || '';
}
