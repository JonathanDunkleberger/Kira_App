import { NextRequest, NextResponse } from 'next/server';
import { getSupabaseServerAdmin } from '@/lib/supabaseAdmin';

export const runtime = 'edge';

export async function GET(
  req: NextRequest,
  { params }: { params: { id: string } }
) {
  const conversationId = params.id;
  if (!conversationId) {
    return NextResponse.json({ error: 'Missing conversation ID' }, { status: 400 });
  }

  const sb = getSupabaseServerAdmin();
  const { data, error } = await sb
    .from('conversations')
    .select('seconds_remaining')
    .eq('id', conversationId)
    .eq('is_guest', true)
    .single();

  if (error || !data) {
    return NextResponse.json({ error: 'Guest conversation not found' }, { status: 404 });
  }

  return NextResponse.json({ secondsRemaining: data.seconds_remaining });
}
