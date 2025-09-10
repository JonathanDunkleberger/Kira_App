// lib/entitlements.ts
// Utilities for loading entitlement + usage snapshot from new schema
import { createClient } from '@supabase/supabase-js';
import { prisma } from './prisma';

const svc = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!,
  {
    auth: { persistSession: false, autoRefreshToken: false },
  },
);

export interface EntitlementsSnapshot {
  plan: 'free' | 'supporter';
  todaySecondsUsed: number;
  todaySecondsLimit: number; // 0 == unlimited
  chatSecondsElapsed: number;
  chatSecondsCap: number; // 7200 for pro, maybe same as daily for free
}

const FREE_DAILY_LIMIT = parseInt(process.env.DAILY_FREE_SECONDS_LIMIT || '300', 10);
const PRO_SESSION_LIMIT = parseInt(process.env.PRO_USER_CONVERSATION_SECONDS_LIMIT || '7200', 10);

export async function loadEntitlements(
  userId: string,
  chatSessionId: string,
): Promise<EntitlementsSnapshot> {
  // Fetch entitlement plan
  const { data: ent } = await svc
    .from('user_entitlements')
    .select('plan')
    .eq('user_id', userId)
    .maybeSingle();
  const plan = (ent?.plan as 'free' | 'supporter') || 'free';
  const isPro = plan === 'supporter';

  // daily usage row
  const today = new Date().toISOString().slice(0, 10);
  const { data: daily } = await svc
    .from('daily_usage')
    .select('seconds_used')
    .eq('user_id', userId)
    .eq('day', today)
    .maybeSingle();
  const todaySecondsUsed = Number(daily?.seconds_used || 0);

  // Use Prisma conversation as authoritative; fallback to 0 if missing
  let chatSecondsElapsed = 0;
  try {
    const convo = await prisma.conversation.findUnique({
      where: { id: chatSessionId },
      select: { secondsRemaining: true },
    });
    // Original semantic was elapsed seconds; if model stores remaining, convert if both limits known.
    // For now interpret secondsRemaining as inverse of elapsed relative to today limit when finite.
    if (convo?.secondsRemaining != null) {
      const limit = plan === 'supporter' ? PRO_SESSION_LIMIT : FREE_DAILY_LIMIT;
      chatSecondsElapsed = Math.max(0, limit - convo.secondsRemaining);
    }
  } catch {}

  return {
    plan,
    todaySecondsUsed,
    todaySecondsLimit: isPro ? 0 : FREE_DAILY_LIMIT,
    chatSecondsElapsed,
    chatSecondsCap: isPro ? PRO_SESSION_LIMIT : FREE_DAILY_LIMIT,
  };
}
