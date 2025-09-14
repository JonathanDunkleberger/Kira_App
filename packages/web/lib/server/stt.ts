import {
  spawn,
  type ChildProcessByStdio,
  type ChildProcessWithoutNullStreams,
} from 'node:child_process';

import ffmpegPath from 'ffmpeg-static';

async function transcodeWebmToWav16k(bytes: Uint8Array): Promise<Uint8Array> {
  // If ffmpeg is unavailable, just return original bytes (caller can fall back)
  if (!ffmpegPath) {
    throw new Error('ffmpeg-static not available');
  }
  return await new Promise<Uint8Array>((resolve, reject) => {
    try {
      const ff = spawn(
        ffmpegPath as string,
        [
          '-hide_banner',
          '-loglevel',
          'error',
          '-i',
          'pipe:0',
          // Output: 16kHz mono PCM WAV
          '-ar',
          '16000',
          '-ac',
          '1',
          '-f',
          'wav',
          'pipe:1',
        ],
        { stdio: ['pipe', 'pipe', 'pipe'] },
      ) as unknown as ChildProcessWithoutNullStreams;

      const chunks: Buffer[] = [];
      ff.stdout?.on('data', (d: Buffer) => chunks.push(d));
      const errChunks: Buffer[] = [];
      ff.stderr?.on('data', (d: Buffer) => errChunks.push(d));
      ff.on('error', (err: unknown) => reject(err as any));
      ff.on('close', (code: number) => {
        if (code !== 0) {
          const msg = Buffer.concat(errChunks).toString('utf8');
          return reject(new Error(`ffmpeg exited with code ${code}: ${msg}`));
        }
        resolve(new Uint8Array(Buffer.concat(chunks)));
      });

      ff.stdin?.write(bytes);
      ff.stdin?.end();
    } catch (e) {
      reject(e);
    }
  });
}

export async function transcribeWebmToText(bytes: Uint8Array): Promise<string> {
  const apiKey = process.env.OPENAI_API_KEY || '';
  if (!apiKey) throw new Error('OPENAI_API_KEY missing for STT');

  // Prefer optimal 16kHz mono WAV for faster Whisper processing
  let wavBytes: Uint8Array | null = null;
  try {
    wavBytes = await transcodeWebmToWav16k(bytes);
  } catch (err) {
    // Fallback: submit original WebM if transcoding fails
    try {
      console.warn('[STT] Transcode failed, falling back to WebM:', err);
    } catch {}
  }

  const form = new FormData();
  if (wavBytes) {
    // Create a new ArrayBuffer view to avoid SharedArrayBuffer issues
    const abWav = new ArrayBuffer(wavBytes.byteLength);
    new Uint8Array(abWav).set(wavBytes);
    const wavBlob = new Blob([abWav as ArrayBuffer], { type: 'audio/wav' });
    form.append('file', wavBlob, 'audio.wav');
  } else {
    const ab = new ArrayBuffer(bytes.byteLength);
    new Uint8Array(ab).set(bytes);
    const blob = new Blob([ab as ArrayBuffer], { type: 'audio/webm' });
    form.append('file', blob, 'audio.webm');
  }
  form.append('model', 'whisper-1');
  form.append('language', 'en');
  form.append('temperature', '0');

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
