export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const revalidate = 0;

import type { NextRequest } from 'next/server';

const OPENAI_API_KEY = process.env.OPENAI_API_KEY!;

export async function GET(req: NextRequest) {
  try {
    const { searchParams } = new URL(req.url);
    const text = (searchParams.get('q') || '').slice(0, 800);
    if (!text) return new Response('Missing q', { status: 400 });

    const resp = await fetch('https://api.openai.com/v1/audio/speech', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${OPENAI_API_KEY}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        model: 'gpt-4o-mini-tts',
        voice: 'verse',
        input: text,
        format: 'mp3',
      }),
    });

    if (!resp.ok) {
      const err = await resp.text().catch(() => 'tts failed');
      return new Response(err, { status: 502 });
    }

    const buf = Buffer.from(await resp.arrayBuffer());
    return new Response(buf, {
      status: 200,
      headers: {
        'Content-Type': 'audio/mpeg',
        'Cache-Control': 'no-store',
      },
    });
  } catch (e: any) {
    return new Response('error', { status: 500 });
  }
}
