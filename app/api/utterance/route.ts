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
      const arr = new Uint8Array(await (audio as Blob).arrayBuffer());
      transcript = await transcribeWebmToText(arr);
      if (!transcript) return NextResponse.json({ error: "Empty transcript" }, { status: 400 });
    } else {
      const body = await req.json().catch(() => ({}));
      if (!body?.text || typeof body.text !== "string") {
        return NextResponse.json({ error: "Missing text" }, { status: 400 });
      }
      transcript = body.text;
      if (!conversationId && typeof body.conversationId === 'string') conversationId = body.conversationId;
    }

    // With conversations: load recent messages for context and persist both sides
    const sb = getSupabaseServerAdmin();
    let reply: string;
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
    const audioMp3Base64 = await synthesizeSpeech(reply);

    // naive estimate ~15 chars/sec for daily decrement (skip for Pro)
    if (ent.status !== 'active') {
      const estSeconds = Math.max(1, Math.ceil(reply.length / 15));
      await decrementDailySeconds(userId, estSeconds);
      return NextResponse.json({ transcript, reply, audioMp3Base64, estSeconds }, { status: 200 });
    }

    // Pro users: return with estSeconds=0
  return NextResponse.json({ transcript, reply, audioMp3Base64, estSeconds: 0 }, { status: 200 });
  } catch (e: any) {
    console.error("/api/utterance error:", e);
    return NextResponse.json({ error: "Server error" }, { status: 500 });
  }
}
