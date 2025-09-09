// lib/useUsage.ts
// Heartbeat-driven usage tracking store
'use client';
import { create } from 'zustand';

type ServerState = {
  plan: 'guest' | 'free' | 'supporter' | 'pro';
  todaySecondsUsed: number;
  todaySecondsLimit: number; // 0 => unlimited
  chatSecondsElapsed: number;
  chatSecondsCap: number;
  chatSessionId?: string;
};

type UsageState = {
  lastHeartbeatAt: number | null;
  server: ServerState | null;
  setHeartbeat: (hb: any) => void;
  setChatSessionId: (id?: string) => void;
  getDisplayTimes: () => { todayUsed: number; chatElapsed: number };
};

export const useUsage = create<UsageState>((set, get) => ({
  lastHeartbeatAt: null,
  server: null,
  setHeartbeat: (hb) =>
    set((s) => {
      const ent = hb.entitlements as ServerState;
      // preserve existing chatSessionId if heartbeat omits it
      const merged: ServerState = { ...s.server, ...ent } as ServerState;
      if (!ent.chatSessionId && s.server?.chatSessionId) merged.chatSessionId = s.server.chatSessionId;
      return {
        server: merged,
        lastHeartbeatAt: hb.now as number,
      };
    }),
  setChatSessionId: (id) =>
    set((s) => {
      const next = { ...(s.server || ({} as ServerState)), chatSessionId: id };
      try {
        if (id) sessionStorage.setItem('kira_chat_session_id', id);
        else sessionStorage.removeItem('kira_chat_session_id');
      } catch {}
      return { server: next };
    }),
  getDisplayTimes: () => {
    const s = get().server;
    if (!s) return { todayUsed: 0, chatElapsed: 0 };
    const last = get().lastHeartbeatAt;
    const drift = last ? Math.floor((Date.now() - last) / 1000) : 0;
    return {
      todayUsed: s.todaySecondsUsed + drift,
      chatElapsed: s.chatSecondsElapsed + drift,
    };
  },
}));

// Hydration restore (client only)
if (typeof window !== 'undefined') {
  try {
    const saved = sessionStorage.getItem('kira_chat_session_id');
    if (saved) useUsage.getState().setChatSessionId(saved);
  } catch {}
}
