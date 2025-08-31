import { NextRequest, NextResponse } from 'next/server';
import { getSupabaseServerAdmin } from '@/lib/supabaseAdmin';
import OpenAI from 'openai';

export const runtime = 'nodejs';

const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

export async function POST(req: NextRequest) {
  try {
    const { conversationId } = await req.json();
    if (!conversationId) return NextResponse.json({ error: 'Missing conversationId' }, { status: 400 });

    const sb = getSupabaseServerAdmin();
    const token = req.headers.get('authorization')?.replace('Bearer ', '');
    let userId: string | null = null;
    if (token) {
      const { data } = await sb.auth.getUser(token);
      userId = (data as any)?.user?.id || null;
    }
    if (!userId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

    const { data: msgs, error } = await sb
      .from('messages')
      .select('role, content')
      .eq('conversation_id', conversationId)
      .order('created_at', { ascending: false })
      .limit(10);
    if (error) throw error;

    const ordered = (msgs || []).reverse();
    const convo = ordered.map((m: any) => `${m.role}: ${m.content}`).join('\n');
    const prompt = "Summarize the key facts learned about the user from this conversation in a few concise, third-person bullet points (e.g., - User is playing Fallout New Vegas.). Only output the facts. If no new personal facts are learned, return an empty string.";

    const resp = await openai.chat.completions.create({
      model: process.env.OPENAI_MODEL || 'gpt-4o-mini',
      messages: [
        { role: 'system', content: 'You write tersely.' },
        { role: 'user', content: `${prompt}\n\nConversation:\n${convo}` },
      ],
      max_tokens: 200,
      temperature: 0.2,
    });

    const summary = (resp.choices?.[0]?.message?.content || '').trim();
    if (summary) {
      await sb.from('user_memories').insert({ user_id: userId, content: summary });
    }

    return NextResponse.json({ ok: true });
  } catch (e: any) {
    console.error('Summarize error:', e);
    return NextResponse.json({ error: e?.message || 'Server error' }, { status: 500 });
  }
}
