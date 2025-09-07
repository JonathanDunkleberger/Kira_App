import { NextRequest, NextResponse } from 'next/server';

import { getSupabaseServerAdmin } from '@/lib/server/supabaseAdmin';
import { FREE_TRIAL_SECONDS } from '@/lib/server/env.server';

export const dynamic = 'force-dynamic';

// GET all conversations for the authenticated user
export async function GET(req: NextRequest) {
  const token = req.headers.get('authorization')?.replace('Bearer ', '');
  if (!token) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const sb = getSupabaseServerAdmin();
  const {
    data: { user },
  } = await sb.auth.getUser(token);
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const { data, error } = await sb
    .from('conversations')
    .select('id, title, created_at, updated_at')
    .eq('user_id', user.id)
    .order('updated_at', { ascending: false });

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json(data ?? []);
}

// POST to create a new conversation
export async function POST(req: NextRequest) {
  const token = req.headers.get('authorization')?.replace('Bearer ', '');
  const sb = getSupabaseServerAdmin();
  let userId: string | null = null;

  if (token) {
    try {
      const {
        data: { user },
      } = await sb.auth.getUser(token);
      userId = user?.id ?? null;
    } catch {}
  }

  const { title } = await req.json().catch(() => ({}));
  const isGuest = !userId;

  const insert = {
    user_id: userId,
    title: title || 'New Conversation',
    is_guest: isGuest,
    seconds_remaining: isGuest ? FREE_TRIAL_SECONDS : null,
  } as any;

  const { data, error } = await sb
    .from('conversations')
    .insert(insert)
    .select('id, title, created_at, updated_at')
    .single();

  if (error) {
    console.error('Error creating conversation:', error);
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
  return NextResponse.json(data);
}
