import OpenAI from 'openai';

export async function transcribeWebmToText(bytes: Uint8Array): Promise<string> {
  const apiKey = process.env.OPENAI_API_KEY || '';
  if (!apiKey) {
    throw new Error('OPENAI_API_KEY missing for STT');
  }
  const openai = new OpenAI({ apiKey });
  // OpenAI expects a File-like object in Node; polyfill File if needed
  let FileCtor: any = (globalThis as any).File;
  if (!FileCtor) {
    FileCtor = class NodeFile extends Blob {
      name: string;
      lastModified: number;
      constructor(chunks: any[], name: string, opts?: any) {
        super(chunks, opts);
        this.name = name;
        this.lastModified = opts?.lastModified ?? Date.now();
      }
    } as any;
  }
  const file: any = new FileCtor([bytes], 'audio.webm', { type: 'audio/webm' });
  const result = await openai.audio.transcriptions.create({
    file,
    model: 'whisper-1'
  } as any);
  // @ts-ignore
  return (result.text as string)?.trim() || '';
}
