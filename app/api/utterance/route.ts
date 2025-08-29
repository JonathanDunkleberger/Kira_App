import { NextRequest, NextResponse } from "next/server";
import { generateReply, generateReplyWithHistory } from "@/lib/llm";
import { synthesizeSpeech } from "@/lib/tts";
import { transcribeWebmToText } from "@/lib/stt";
import { getSupabaseServerAdmin } from "@/lib/supabaseAdmin";
import { ensureEntitlements, getEntitlement, getDailySecondsRemaining, decrementDailySeconds } from "@/lib/usage";
import { env, FREE_TRIAL_SECONDS } from "@/lib/env";

export const runtime = "nodejs";

export async function POST(req: NextRequest) {
  try {
    // Auth (Supabase access token) — allow bypass in dev if configured
    let userId: string | null = null;
    const auth = req.headers.get("authorization") || "";
    const token = auth.startsWith("Bearer ") ? auth.slice(7) : null;
    if (token) {
      const sb = getSupabaseServerAdmin();
      const { data: userData } = await sb.auth.getUser(token);
      userId = userData?.user?.id || null;
    }
    if (!userId) {
      if (env.DEV_ALLOW_NOAUTH === '1') userId = 'dev-user';
      else return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    // Ensure daily trial counters
    await ensureEntitlements(userId, FREE_TRIAL_SECONDS);
    const ent = await getEntitlement(userId);
    const dailyRemaining = await getDailySecondsRemaining(userId);

    if (ent.status !== 'active' && dailyRemaining <= 0) {
      return NextResponse.json({ paywall: true }, { status: 402 });
    }

    // Parse input
    let transcript = "";
    let conversationId: string | null = null;
    const url = new URL(req.url);
    conversationId = url.searchParams.get('conversationId');
    const ctype = req.headers.get("content-type") || "";
    if (ctype.includes("multipart/form-data")) {
      const form = await req.formData();
      const audio = form.get("audio");
      if (!(audio instanceof Blob)) {
        return NextResponse.json({ error: "Missing audio" }, { status: 400 });
      }
      try {
        const arr = new Uint8Array(await (audio as Blob).arrayBuffer());
        transcript = await transcribeWebmToText(arr);
      } catch (transcribeError) {
        console.error("Transcription error:", transcribeError);
        return NextResponse.json({ error: "Transcription failed" }, { status: 500 });
      }
      if (!transcript?.trim()) return NextResponse.json({ error: "Empty transcript" }, { status: 400 });
    } else {
      try {
        const body = await req.json();
        if (!body?.text || typeof body.text !== "string") {
          return NextResponse.json({ error: "Missing text" }, { status: 400 });
        }
        transcript = body.text;
        if (!conversationId && typeof body.conversationId === 'string') conversationId = body.conversationId;
      } catch (jsonError) {
        console.error("JSON parsing error:", jsonError);
        return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
      }
    }

    // With conversations: load recent messages for context and persist both sides
    const sb = getSupabaseServerAdmin();
    let reply: string;
    try {
      if (conversationId) {
        // Verify ownership and fetch history
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
        const history = (msgs ?? []).map(m => ({ role: m.role as 'user'|'assistant', content: m.content as string }));
        reply = await generateReplyWithHistory(history, transcript);
        // persist user and assistant messages, touch conversation updated_at
        await sb.from('messages').insert([
          { conversation_id: conversationId, role: 'user', content: transcript },
          { conversation_id: conversationId, role: 'assistant', content: reply },
        ]);
        await sb.from('conversations').update({ updated_at: new Date().toISOString() }).eq('id', conversationId);
      } else {
        reply = await generateReply(transcript);
      }
    } catch (llmError) {
      console.error("LLM error:", llmError);
      return NextResponse.json({ error: "Failed to generate response" }, { status: 500 });
    }

    let audioMp3Base64 = "";
    try {
      audioMp3Base64 = await synthesizeSpeech(reply);
    } catch (ttsError) {
      console.error("TTS error:", ttsError);
      // continue without audio
    }

    // naive estimate ~15 chars/sec for daily decrement (skip for Pro)
    let estSeconds = 0;
    if (ent.status !== 'active') {
      estSeconds = Math.max(1, Math.ceil(reply.length / 15));
      await decrementDailySeconds(userId, estSeconds);
    }

    return NextResponse.json({ transcript, reply, audioMp3Base64, estSeconds }, { status: 200 });
  } catch (e: any) {
    console.error("/api/utterance error:", e);
    return NextResponse.json({ error: "Server error: " + e.message }, { status: 500 });
  }
}
