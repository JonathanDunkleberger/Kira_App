import { NextRequest, NextResponse } from 'next/server';
import { synthesizeSpeech } from '@/lib/tts';

export const runtime = 'nodejs';

export async function POST(req: NextRequest) {
  try {
    let text = '';
    const ctype = req.headers.get('content-type') || '';
    if (ctype.includes('application/json')) {
      const body = await req.json().catch(() => ({}));
      if (!body?.text || typeof body.text !== 'string') {
        return NextResponse.json({ error: 'Missing text' }, { status: 400 });
      }
      text = body.text as string;
    } else {
      const form = await req.formData();
      const t = form.get('text');
      if (typeof t !== 'string' || !t) {
        return NextResponse.json({ error: 'Missing text' }, { status: 400 });
      }
      text = t;
    }

    const audioMp3Base64 = await synthesizeSpeech(text);
    // Convert base64 to ArrayBuffer and return as binary for robust playback
    const binary = atob(audioMp3Base64);
    const bytes = new Uint8Array(binary.length);
    for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
    const ab = bytes.buffer as ArrayBuffer;
    return new NextResponse(ab, {
      status: 200,
      headers: {
        'Content-Type': 'audio/mpeg',
        'Cache-Control': 'no-store',
      },
    });
  } catch (e: any) {
    console.error('/api/synthesize error:', e);
    return NextResponse.json({ error: e?.message || 'TTS failed' }, { status: 500 });
  }
}
