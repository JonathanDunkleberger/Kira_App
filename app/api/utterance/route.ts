import { NextRequest, NextResponse } from 'next/server';
import { env, FREE_TRIAL_SECONDS } from '@/lib/env';
import { getSupabaseServerAdmin } from '@/lib/supabaseAdmin';
import { ensureEntitlements, getEntitlement, getDailySecondsRemaining, decrementDailySeconds } from '@/lib/usage';
import { transcribeWebmToText } from '@/lib/stt';

export const runtime = 'edge';

async function streamOpenAI(prompt: string, history: Array<{ role: 'user'|'assistant'; content: string }>) {
  const apiKey = process.env.OPENAI_API_KEY || '';
  const model = process.env.OPENAI_MODEL || 'gpt-4o-mini';
  if (!apiKey) throw new Error('OPENAI_API_KEY missing');

  const messages = [
    { role: 'system', content: 'You are Kira. Respond in natural, spoken dialogue, no stage directions.' },
    ...history.map(m => ({ role: m.role, content: m.content })),
    { role: 'user', content: prompt },
  ];

  const r = await fetch('https://api.openai.com/v1/chat/completions', {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${apiKey}`,
      'Content-Type': 'application/json'
    },
    body: JSON.stringify({
      model,
      messages,
      temperature: 0.7,
      top_p: 0.9,
      stream: true,
      max_tokens: 400
    })
  });
  if (!r.ok || !r.body) {
    const txt = await r.text().catch(() => '');
    throw new Error(`OpenAI streaming failed: ${r.status} ${txt}`);
  }
  return r.body as ReadableStream<Uint8Array>;
}

export async function POST(req: NextRequest) {
  try {
    // Auth
    let userId: string | null = null;
    const auth = req.headers.get('authorization') || '';
    const token = auth.startsWith('Bearer ') ? auth.slice(7) : null;
    if (token) {
      const sb = getSupabaseServerAdmin();
      const { data: userData } = await sb.auth.getUser(token);
      userId = userData?.user?.id || null;
    }
    if (!userId) {
      if (env.DEV_ALLOW_NOAUTH === '1') userId = 'dev-user';
      else return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    // Entitlements
    await ensureEntitlements(userId, FREE_TRIAL_SECONDS);
    const ent = await getEntitlement(userId);
    const dailyRemaining = await getDailySecondsRemaining(userId);
    if (ent.status !== 'active' && dailyRemaining <= 0) {
      return NextResponse.json({ paywall: true }, { status: 402 });
    }

    // Parse input (audio multipart or JSON) and optional conversationId
    const url = new URL(req.url);
    let conversationId: string | null = url.searchParams.get('conversationId');
    let transcript = '';

    const ctype = req.headers.get('content-type') || '';
    if (ctype.includes('multipart/form-data')) {
      const form = await req.formData();
      const audio = form.get('audio');
      if (!(audio instanceof Blob)) {
        return NextResponse.json({ error: 'Missing audio' }, { status: 400 });
      }
      const arr = new Uint8Array(await (audio as Blob).arrayBuffer());
      transcript = await transcribeWebmToText(arr);
      if (!transcript?.trim()) return NextResponse.json({ error: 'Empty transcript' }, { status: 400 });
    } else if (ctype.includes('application/json')) {
      const body = await req.json().catch(() => ({}));
      if (!body?.text || typeof body.text !== 'string') {
        return NextResponse.json({ error: 'Missing text' }, { status: 400 });
      }
      transcript = body.text;
      if (!conversationId && typeof body.conversationId === 'string') conversationId = body.conversationId;
    } else {
      return NextResponse.json({ error: 'Unsupported content type' }, { status: 415 });
    }

    const sb = getSupabaseServerAdmin();
    let history: Array<{ role: 'user'|'assistant'; content: string }> = [];

    if (conversationId) {
      const { data: conv } = await sb.from('conversations').select('id, user_id').eq('id', conversationId).maybeSingle();
      if (!conv || conv.user_id !== userId) {
        return NextResponse.json({ error: 'Conversation not found' }, { status: 404 });
      }
      const { data: msgs } = await sb
        .from('messages')
        .select('role, content')
        .eq('conversation_id', conversationId)
        .order('created_at', { ascending: true })
        .limit(20);
      history = (msgs ?? []).map(m => ({ role: m.role as 'user'|'assistant', content: m.content as string }));
      // insert user message immediately for realtime sidebar freshness
      await sb.from('messages').insert({ conversation_id: conversationId, role: 'user', content: transcript });
      await sb.from('conversations').update({ updated_at: new Date().toISOString() }).eq('id', conversationId);
    }

    // Stream from OpenAI
    const stream = await streamOpenAI(transcript, history);

    // We'll accumulate text to compute decrement and persist assistant on completion
    let fullText = '';

    const reader = stream.getReader();
    const encoder = new TextEncoder();
    const decoder = new TextDecoder();

    const readable = new ReadableStream<Uint8Array>({
      async start(controller) {
        // Send a small prelude so clients can prepare; include event for UI if needed
        // Set transcript via header on the Response below
        while (true) {
          const { value, done } = await reader.read();
          if (done) break;
          // OpenAI streams as server-sent events (data: ... lines)
          const chunk = decoder.decode(value, { stream: true });
          // Parse minimally: forward as-is to client; also extract content deltas
          const lines = chunk.split('\n');
          for (const line of lines) {
            const trimmed = line.trim();
            if (!trimmed.startsWith('data:')) continue;
            const data = trimmed.slice(5).trim();
            if (data === '[DONE]') continue;
            try {
              const j = JSON.parse(data);
              const delta = j.choices?.[0]?.delta?.content || '';
              if (delta) fullText += delta;
            } catch {}
          }
          controller.enqueue(encoder.encode(chunk));
        }
        controller.close();
      },
      async cancel() {
        try { await reader.cancel(); } catch {}
      }
    });

    // On completion work happens after stream consumed by client; but we cannot await here.
    // Use a tee to observe the end and then persist assistant + decrement.
    // For simplicity in Edge, we perform a background void async task (best-effort).
    (async () => {
      try {
        // tiny delay to ensure fullText captured
        await new Promise(r => setTimeout(r, 50));
        if (conversationId && fullText.trim()) {
          await sb.from('messages').insert({ conversation_id: conversationId, role: 'assistant', content: fullText });
          await sb.from('conversations').update({ updated_at: new Date().toISOString() }).eq('id', conversationId);
        }
        if (ent.status !== 'active' && fullText) {
          const estSeconds = Math.max(1, Math.ceil(fullText.length / 15));
          await decrementDailySeconds(userId!, estSeconds);
        }
      } catch (e) {
        console.error('post-stream persistence failed', e);
      }
    })();

    const headers = new Headers({
      'Content-Type': 'text/event-stream; charset=utf-8',
      'Cache-Control': 'no-cache, no-transform',
      'X-Transcript': encodeURIComponent(transcript)
    });

    return new Response(readable, { status: 200, headers });
  } catch (e: any) {
    console.error('/api/utterance (edge) error:', e);
    return NextResponse.json({ error: e?.message || 'Server error' }, { status: 500 });
  }
}
