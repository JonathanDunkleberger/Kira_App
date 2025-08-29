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
    return NextResponse.json({ audioMp3Base64 }, { status: 200 });
  } catch (e: any) {
    console.error('/api/synthesize error:', e);
    return NextResponse.json({ error: e?.message || 'TTS failed' }, { status: 500 });
  }
}
