import { NextRequest, NextResponse } from 'next/server';
import { getSupabaseServerAdmin } from '@/lib/server/supabaseAdmin';
import OpenAI from 'openai';

const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

const MEMORY_EXTRACTION_PROMPT = `
You are a memory extraction AI. Your job is to analyze a conversation and identify key facts, entities, user preferences, or decisions that should be saved for long-term memory.
Extract these facts as a concise JSON array of strings.
- Only extract durable, important information.
- Do NOT extract conversational filler like greetings or acknowledgements.
- Keep each fact as a short, self-contained statement.

Example:
Conversation:
User: "Hey Kira, I'm thinking of starting a new game, maybe Undertale."
Assistant: "Oh, Undertale is a classic! Are you going for a pacifist run?"
User: "Yeah, I want to try the pacifist route first. My friend Alex said it's the best way to experience it."
Assistant: "Great choice! Alex is right."

JSON Output:
["The user is playing the game Undertale.", "The user's goal is to complete a pacifist run.", "The user has a friend named Alex."]
`;

export async function POST(req: NextRequest) {
  try {
    const { userId, messages } = await req.json();
    const sbAdmin = getSupabaseServerAdmin();

    if (!userId || !messages || messages.length === 0) {
      return NextResponse.json({ success: false, error: 'Missing user ID or messages' }, { status: 400 });
    }

    // Format the recent messages for the extraction prompt
    const conversationText = (messages as Array<{ role: string; content: string }>)
      .map((m) => `${m.role}: ${m.content}`)
      .join('\n');

    // Ask LLM to extract durable facts/preferences
    const response = await openai.chat.completions.create({
      model: process.env.OPENAI_MODEL || 'gpt-4o-mini',
      messages: [
        { role: 'system', content: MEMORY_EXTRACTION_PROMPT },
        { role: 'user', content: conversationText },
      ],
      response_format: { type: 'json_object' },
      max_tokens: 300,
      temperature: 0.2,
    });

  // Parse JSON array from the model output
    let facts: string[] = [];
    try {
      const content = response.choices?.[0]?.message?.content || '[]';
      const parsed = JSON.parse(content);
      if (Array.isArray(parsed)) facts = parsed as string[];
      else if (Array.isArray(parsed?.facts)) facts = parsed.facts as string[];
    } catch {
      facts = [];
    }

    if (!facts.length) {
      return NextResponse.json({ success: true, message: 'No new memories to save.' });
    }

    // Create embeddings for each fact
    const embeddingResponse = await openai.embeddings.create({
      model: 'text-embedding-3-small',
      input: facts,
    });

    const memoriesToInsert = facts.map((fact, i) => ({
      user_id: userId as string,
      content: fact,
      embedding: embeddingResponse.data[i].embedding,
    }));

    const { error } = await sbAdmin.from('user_memories').insert(memoriesToInsert);
    if (error) throw error;

  return NextResponse.json({ success: true, memories_saved: facts.length });
  } catch (error: any) {
    console.error('Memory extraction failed:', error);
    return NextResponse.json({ success: false, error: error?.message || 'Unknown error' }, { status: 500 });
  }
}

// Lightweight count endpoint: return number of memories for the authed user
export async function GET(req: NextRequest) {
  try {
    const sbAdmin = getSupabaseServerAdmin();
    const token = req.headers.get('authorization')?.replace('Bearer ', '');
    if (!token) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    const { data: userData } = await sbAdmin.auth.getUser(token);
    const userId = (userData as any)?.user?.id as string | undefined;
    if (!userId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

    const { count, error } = await sbAdmin
      .from('user_memories')
      .select('*', { count: 'exact', head: true })
      .eq('user_id', userId);
    if (error) throw error;
    return NextResponse.json({ count: count ?? 0 });
  } catch (error: any) {
    return NextResponse.json({ error: error?.message || 'Unknown error' }, { status: 500 });
  }
}
