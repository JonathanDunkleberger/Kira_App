// server/heartbeat.ts
import { createClient } from '@supabase/supabase-js';

import { loadEntitlements } from '@/lib/entitlements';

const svc = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!,
  {
    auth: { persistSession: false, autoRefreshToken: false },
  },
);

export type HeartbeatPayload = {
  t: 'heartbeat';
  now: number;
  entitlements: Awaited<ReturnType<typeof loadEntitlements>> & {
    todaySecondsUsed: number;
    chatSecondsElapsed: number;
  };
  remainingToday: number; // -1 unlimited
  remainingThisChat: number;
  paywall: boolean;
  hardStop: boolean;
  chatSessionId: string;
};

const TICK = 5; // seconds

export function startHeartbeat(ws: any, userId: string, chatSessionId: string) {
  const timer = setInterval(async () => {
    try {
      const ent = await loadEntitlements(userId, chatSessionId);
      const isPro = ent.todaySecondsLimit === 0; // 0 denotes unlimited daily
      const remainingToday = isPro ? -1 : Math.max(0, ent.todaySecondsLimit - ent.todaySecondsUsed);
      const remainingChat = Math.max(0, ent.chatSecondsCap - ent.chatSecondsElapsed);
      const paywall = !isPro && remainingToday === 0;
      const hardStop = remainingChat === 0;

      if (!paywall && !hardStop) {
        // increment daily + chat in one round trip if accrue_daily_usage RPC exists
        try {
          await svc.rpc('accrue_daily_usage', {
            p_user_id: userId,
            p_session_id: chatSessionId,
            p_inc: TICK,
          });
        } catch (e) {
          // fallback to separate increments if atomic RPC missing
          try {
            await svc.rpc('increment_chat_elapsed', { p_chat_id: chatSessionId, p_seconds: TICK });
          } catch {}
        }
      }

      const hb: HeartbeatPayload = {
        t: 'heartbeat',
        now: Date.now(),
        entitlements: {
          ...ent,
          todaySecondsUsed: ent.todaySecondsUsed + (paywall || hardStop ? 0 : TICK),
          chatSecondsElapsed: ent.chatSecondsElapsed + (paywall || hardStop ? 0 : TICK),
        },
        remainingToday,
        remainingThisChat: remainingChat,
        paywall,
        hardStop,
        chatSessionId,
      };
      if (ws.readyState === 1) ws.send(JSON.stringify(hb));
      // Optionally stop incrementing if capped
      // if (paywall || hardStop) clearInterval(timer);
    } catch (e) {
      console.error('heartbeat error', e);
    }
  }, TICK * 1000);

  ws.onclose = () => clearInterval(timer);
}
