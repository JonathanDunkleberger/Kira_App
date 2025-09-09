'use client';
import { useEffect, useState } from 'react';

import { useUsage } from '../lib/useUsage';
import { supaBrowser } from '../lib/supabase-browser';

import LimitDialog, { type LimitDialogMode } from './dialogs/LimitDialog';

export default function ChatGuardrails({ children }: { children: React.ReactNode }) {
  const [open, setOpen] = useState(false);
  const [mode, setMode] = useState<LimitDialogMode>('paywall');
  const [remainingToday, setRemainingToday] = useState(0);
  const [remainingThisChat, setRemainingThisChat] = useState(0);
  const { server, setChatSessionId } = useUsage() as any;
  const [isAuthed, setAuthed] = useState(false);
  const [isPro, setIsPro] = useState(false);
  const [usedToday, setUsedToday] = useState<number | undefined>();
  const [usedThisChat, setUsedThisChat] = useState<number | undefined>();
  const todayCap = server?.todaySecondsLimit ?? 0;
  const chatCap = server?.chatSecondsCap ?? 0;

  useEffect(() => {
    (async () => {
      try {
        const supa = supaBrowser();
        const { data } = await supa.auth.getUser();
        setAuthed(!!data.user);
      } catch {
        setAuthed(false);
      }
    })();
  }, []);

  useEffect(() => {
    const handler = (msg: any) => {
      if (!msg || msg.t !== 'heartbeat') return;
      const pro = server?.todaySecondsLimit === 0;
      setIsPro(!!pro);
      setUsedToday(msg.usedToday);
      setUsedThisChat(msg.usedThisChat);
      if (!pro) {
        if (msg.remainingToday > 0 && msg.remainingToday <= 120) {
          setMode('paywall');
          setRemainingToday(msg.remainingToday);
          setOpen(true);
        }
        if (msg.paywall) {
          setMode('paywall');
          setRemainingToday(0);
          setOpen(true);
        }
      }
      if (msg.remainingThisChat > 0 && msg.remainingThisChat <= 120) {
        setMode('chat-cap');
        setRemainingThisChat(msg.remainingThisChat);
        setOpen(true);
      }
      if (msg.hardStop) {
        setMode('chat-cap');
        setRemainingThisChat(0);
        setOpen(true);
      }
    };
    (window as any).__onHeartbeat = handler;
    return () => {
      if ((window as any).__onHeartbeat === handler) (window as any).__onHeartbeat = null;
    };
  }, [server]);

  return (
    <>
      {children}
      <LimitDialog
        open={open}
        mode={mode}
        remainingToday={remainingToday}
        remainingThisChat={remainingThisChat}
        usedToday={usedToday}
        usedThisChat={usedThisChat}
        todayCap={todayCap}
        chatCap={chatCap}
        isAuthed={isAuthed}
        isPro={isPro}
        onClose={() => setOpen(false)}
        onUpgrade={() => {
          document.querySelector<HTMLButtonElement>('[data-open-billing]')?.click();
          setOpen(false);
        }}
        onLogin={() => {
          document.querySelector<HTMLButtonElement>('[data-open-auth]')?.click();
          setOpen(false);
        }}
        onNewChat={async () => {
          try { (window as any).voice?.endCall?.(); } catch {}
          try { setChatSessionId?.(undefined); } catch {}
          location.assign('/chat');
        }}
      />
    </>
  );
}
