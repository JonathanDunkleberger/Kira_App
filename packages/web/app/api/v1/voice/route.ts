import { NextResponse } from 'next/server';
import { SpeechClient } from '@google-cloud/speech';
import { TextToSpeechClient } from '@google-cloud/text-to-speech';
import OpenAI from 'openai';

function detectEncoding(fileType: string, fileName?: string) {
  const type = (fileType || '').toLowerCase();
  const name = (fileName || '').toLowerCase();
  if (type.includes('webm') || name.endsWith('.webm')) {
    return { encoding: 'WEBM_OPUS' as const, sampleRateHertz: 48000 };
  }
  if (type.includes('mp3') || type.includes('mpeg') || name.endsWith('.mp3')) {
    return { encoding: 'MP3' as const };
  }
  if (type.includes('ogg') || name.endsWith('.ogg')) {
    return { encoding: 'OGG_OPUS' as const };
  }
  return { encoding: 'ENCODING_UNSPECIFIED' as const };
}

export async function POST(req: Request) {
  try {
    const contentType = req.headers.get('content-type') || '';
    if (!contentType.includes('multipart/form-data')) {
      return NextResponse.json(
        { error: "Expected multipart/form-data with a 'file' field" },
        { status: 400 },
      );
    }

    const form = await req.formData();
    const file = form.get('file') as File | null;
    if (!file) {
      return NextResponse.json({ error: "Missing 'file' in form-data" }, { status: 400 });
    }

    const arrayBuffer = await file.arrayBuffer();
    const audioBuffer = Buffer.from(arrayBuffer);

    // 1) STT: Google synchronous recognize
    const speech = new SpeechClient();
    const { encoding, sampleRateHertz } = detectEncoding(file.type, file.name);
    const [sttResp] = await speech.recognize({
      audio: { content: audioBuffer.toString('base64') },
      config: {
        encoding,
        languageCode: process.env.STT_LANGUAGE || 'en-US',
        enableAutomaticPunctuation: true,
        ...(sampleRateHertz ? { sampleRateHertz } : {}),
      } as any,
    });

    const sttText = ((sttResp.results || []) as any[])
      .map((r: any) => r.alternatives?.[0]?.transcript || '')
      .join(' ')
      .trim();

    if (!sttText) {
      return NextResponse.json({ error: 'No transcript produced' }, { status: 422 });
    }

    // 2) LLM: OpenAI non-streaming
    const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
    const systemPrompt =
      process.env.PERSONALITY_PROMPT || 'You are Kira, an encouraging, upbeat AI companion.';

    const completion = await openai.chat.completions.create({
      model: process.env.OPENAI_MODEL || 'gpt-4o-mini',
      messages: [
        { role: 'system', content: systemPrompt },
        { role: 'user', content: sttText },
      ],
    });

    const llmText = completion.choices?.[0]?.message?.content?.trim() || '';
    if (!llmText) {
      return NextResponse.json({ error: 'LLM produced no content' }, { status: 502 });
    }

    // 3) TTS: Google Text-to-Speech -> MP3
    const tts = new TextToSpeechClient();
    const [ttsResp] = await tts.synthesizeSpeech({
      input: { text: llmText },
      voice: {
        languageCode: process.env.TTS_LANGUAGE || 'en-US',
        name: process.env.GOOGLE_TTS_VOICE || 'en-US-Neural2-A',
      },
      audioConfig: { audioEncoding: 'MP3' as const },
    });

    const audioContent = ttsResp.audioContent as Uint8Array | undefined;
    if (!audioContent) {
      return NextResponse.json({ error: 'TTS failed to produce audio' }, { status: 502 });
    }

    const mp3Buffer = Buffer.from(audioContent);
    return new Response(mp3Buffer, {
      status: 200,
      headers: {
        'Content-Type': 'audio/mpeg',
        'Content-Length': String(mp3Buffer.length),
        'Cache-Control': 'no-store',
      },
    });
  } catch (err: any) {
    console.error('[HTTP Voice] Error:', err?.message || err);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}
