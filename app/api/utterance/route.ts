import { NextRequest, NextResponse } from 'next/server';
import { transcribeWebmToText } from '@/lib/stt';
import { chatRespond } from '@/lib/llm';
import { ttsToMp3Base64 } from '@/lib/tts';
import { env } from '@/lib/env';
import { getSupabaseServerAdmin } from '@/lib/supabaseClient';
import { decrementSeconds, getSecondsRemaining, bumpUsage } from '@/lib/usage';

export const runtime = 'nodejs';

export async function POST(req: NextRequest) {
  const origin = req.headers.get('origin') || '';
  if (origin && origin !== env.ALLOWED_ORIGIN && !origin.includes(new URL(env.APP_URL).host)) {
    return new NextResponse('Forbidden origin', { status: 403 });
  }

  const auth = req.headers.get('authorization') || '';
  const accessToken = auth.startsWith('Bearer ') ? auth.slice(7) : null;
  if (!accessToken) return new NextResponse('Missing auth', { status: 401 });

  const sb = getSupabaseServerAdmin();
  const { data: userData, error } = await sb.auth.getUser(accessToken);
  if (error || !userData.user) return new NextResponse('Invalid auth', { status: 401 });
  const userId = userData.user.id;

  const form = await req.formData();
  const sessionToken = form.get('token') as string;
  const blob = form.get('audio') as File;
  if (!sessionToken || !blob) return new NextResponse('Bad request', { status: 400 });

  // Enforce remaining minutes before doing anything costly
  const remaining = await getSecondsRemaining(userId);
  if (remaining <= 0) {
    return NextResponse.json({ paywall: true }, { status: 402, headers: { 'Access-Control-Allow-Origin': origin } });
  }

  // STT
  const webmBuf = Buffer.from(await blob.arrayBuffer());
  const sttStart = Date.now();
  const userText = await transcribeWebmToText(webmBuf);
  const sttSecs = Math.ceil((Date.now() - sttStart) / 1000);

  // LLM
  const llmStart = Date.now();
  const reply = await chatRespond(userText);
  const llmSecs = Math.ceil((Date.now() - llmStart) / 1000);

  // TTS
  const { b64, charCount, estSeconds } = await ttsToMp3Base64(reply);

  // Metering + decrement
  await decrementSeconds(userId, estSeconds);
  await bumpUsage(userId, sttSecs, estSeconds, 0, 0, charCount);

  return NextResponse.json(
    { transcript: userText, reply, audioMp3Base64: b64, estSeconds },
    { headers: { 'Access-Control-Allow-Origin': origin } }
  );
}
