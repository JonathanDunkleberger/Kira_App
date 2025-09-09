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
};

type UsageState = {
  lastHeartbeatAt: number | null;
  server: ServerState | null;
  setHeartbeat: (hb: any) => void;
  getDisplayTimes: () => { todayUsed: number; chatElapsed: number };
};

export const useUsage = create<UsageState>((set, get) => ({
  lastHeartbeatAt: null,
  server: null,
  setHeartbeat: (hb) =>
    set({
      server: hb.entitlements as ServerState,
      lastHeartbeatAt: hb.now as number,
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
